import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { uploadFile, uploadFolder } from './ftp';
import { runRemoteCommand } from './ssh';
export function activate(context: vscode.ExtensionContext) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('请先打开一个工作区');
        return;
    }

    const configPath = path.join(workspaceFolder, '.ftp-mappings.json');

    const ensureConfigFile = () => {
        if (!fs.existsSync(configPath)) {
            const defaultCompilePath = '/home/defaultCompilePath';
            const defaultDeployPath = '/home/defaultCompilePath';

            const defaultConfig = {
                localConfig: {
                    src: path.join(workspaceFolder, 'src'),
                    inc: path.join(workspaceFolder, 'inc'),
                    mak: path.join(workspaceFolder, 'mak')
                },
                ftpConfig: {
                    host: 'your.ftp.server',
                    port: 21,
                    username: 'ftpuser',
                    password: 'ftppassword',

                    remoteSrc: `${defaultCompilePath}/src`,
                    remoteInc: `${defaultCompilePath}/inc`,
                    remoteMak: `${defaultCompilePath}/mak`,

                    compileTXCommand: `cd ${defaultCompilePath}/mak && ./buildTX.sh`,
                    compileBATCommand: `cd ${defaultCompilePath}/mak && ./buildBAT.sh`,
                    deployTXCommand: `cd ${defaultDeployPath} && ./deployTX.ksh`,
                    deployBATCommand: `cd ${defaultDeployPath} && ./deployBAT.ksh`
                }
            };

            fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
            vscode.window.showInformationMessage('已生成默认 .ftp-mappings.json 配置文件');
        }
    };

    const getConfig = (): any => {
        if (!fs.existsSync(configPath)) {
            vscode.window.showErrorMessage('.ftp-mappings.json 不存在');
            return null;
        }
        return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    };

    ensureConfigFile();

    context.subscriptions.push(
        vscode.commands.registerCommand('ibm-xlc-compile-deploy.configureMappings', async () => {
            ensureConfigFile();
            const doc = await vscode.workspace.openTextDocument(configPath);
            await vscode.window.showTextDocument(doc);
        }),

        vscode.commands.registerCommand('ibm-xlc-compile-deploy.upload', async () => {
            const config = getConfig();
            if (!config || !config.ftpConfig) {
                vscode.window.showErrorMessage('配置文件读取失败');
                return;
            }
            const { localConfig, ftpConfig } = config;

            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showErrorMessage('请先打开一个编辑的文件以判断编译命令');
                return;
            }
            const currentFilePath = editor.document.uri.fsPath;
            const relativePath = path.relative(workspaceFolder, currentFilePath).replace(/\\/g, '/');

            if (localConfig.src && ftpConfig.remoteSrc && relativePath.startsWith(localConfig.src)) {
                await uploadFile(relativePath, localConfig.src, ftpConfig.remoteSrc, ftpConfig, workspaceFolder);
                vscode.window.showInformationMessage('src 当前文件上传完成');
            } else if (localConfig.mak && ftpConfig.remoteMak && relativePath.startsWith(localConfig.mak)) {
                await convertToUnixLineEndings(currentFilePath);
                await uploadFile(relativePath, localConfig.mak, ftpConfig.remoteMak, ftpConfig, workspaceFolder);
                vscode.window.showInformationMessage('mak 当前文件上传完成');
            } else if (localConfig.inc && ftpConfig.remoteInc && relativePath.startsWith(localConfig.inc)) {
                await uploadFile(relativePath, localConfig.inc, ftpConfig.remoteInc, ftpConfig, workspaceFolder);
                vscode.window.showInformationMessage('inc 当前文件上传完成');
            }
        }),

        vscode.commands.registerCommand('ibm-xlc-compile-deploy.compileXLC', async () => {
            const config = getConfig();
            if (!config || !config.ftpConfig) {
                vscode.window.showErrorMessage('配置文件读取失败');
                return;
            }

            const { localConfig, ftpConfig } = config;

            if (localConfig.inc && ftpConfig.remoteInc) {
                const confirm = await vscode.window.showWarningMessage(
                    '是否跳过上传 inc 文件夹（会覆盖远程内容）？',
                    { modal: true },
                    '确认',
                );

                if (confirm !== '确认') {
                    await uploadFolder(localConfig.inc, ftpConfig.remoteInc, ftpConfig, workspaceFolder);
                    vscode.window.showInformationMessage('inc 文件夹上传完成');
                } else {
                    vscode.window.showInformationMessage('取消上传 inc 文件夹');
                }
            }

            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showErrorMessage('请先打开一个编辑的文件以判断编译命令');
                return;
            }

            // 获取TX_BAT_ID
            let TX_BAT_ID = '';
            const fileName = path.basename(editor.document.uri.fsPath, path.extname(editor.document.uri.fsPath)); // 去扩展名的文件名
            if (fileName.toUpperCase().includes('TX')) {
                TX_BAT_ID = fileName.toUpperCase().replace(/\.[^/.]+$/, '').slice(2);
            } else if (fileName.toUpperCase().includes('BAT')) {
                TX_BAT_ID = fileName.toUpperCase().replace(/\.[^/.]+$/, '').slice(3);
            } else {
                vscode.window.showWarningMessage('无法识别 TX 或 BAT 开头的文件名，无法提取 TX_BAT_ID');
                return;
            }
            // 上传 src 中匹配的文件
            if (localConfig.src && ftpConfig.remoteSrc) {
                const absLocalPath = path.join(workspaceFolder, localConfig.src);
                const srcFiles = fs.readdirSync(absLocalPath);
                for (const file of srcFiles) {
                    if (file.toUpperCase().includes(TX_BAT_ID)) {
                        const fullPath = path.join(absLocalPath, file);
                        const relativePath = path.relative(workspaceFolder, fullPath).replace(/\\/g, '/');
                        await uploadFile(relativePath, localConfig.src, ftpConfig.remoteSrc, ftpConfig, workspaceFolder);
                    }
                }
                vscode.window.showInformationMessage(`src 目录下所有包含 ${TX_BAT_ID} 的文件已上传`);
            }

            // 上传 mak 中匹配的文件
            if (localConfig.mak && ftpConfig.remoteMak) {
                const absLocalPath = path.join(workspaceFolder, localConfig.mak);
                const makFiles = fs.readdirSync(absLocalPath);
                for (const file of makFiles) {
                    const upper = file.toUpperCase();
                    if (upper.includes(TX_BAT_ID) || upper === 'TX_LIST.MAK') {
                        const fullPath = path.join(absLocalPath, file);
                        await convertToUnixLineEndings(fullPath);
                        const relativePath = path.relative(workspaceFolder, fullPath).replace(/\\/g, '/');
                        await uploadFile(relativePath, localConfig.mak, ftpConfig.remoteMak, ftpConfig, workspaceFolder);
                    }
                }
                vscode.window.showInformationMessage(`mak 目录下所有包含 ${TX_BAT_ID} 的文件以及 tx_list.mak 已上传`);
            }

            let compileCommand: string | undefined;
            let cleanCommand: string | undefined;
            if (fileName.toUpperCase().includes('TX')) {
                compileCommand = config.ftpConfig.compileTXCommand;
                if (!compileCommand) {
                    vscode.window.showErrorMessage('compileTXCommand 未配置');
                    return;
                }
                compileCommand += " tx" + TX_BAT_ID + ".mak";
            } else if (fileName.toUpperCase().includes('BAT')) {
                compileCommand = config.ftpConfig.compileBATCommand;
                if (!compileCommand) {
                    vscode.window.showErrorMessage('compileBATCommand 未配置');
                    return;
                }
                compileCommand += " bat" + TX_BAT_ID + ".mak";
            } else {
                vscode.window.showErrorMessage('文件名不包含 TX 或 BAT，无法判断编译命令');
                return;
            }
            const confirm = await vscode.window.showWarningMessage(
                '是否clean？',
                { modal: true },
                '确认',
            );
            cleanCommand = compileCommand + " clean";
            if (confirm === '确认') {
                await runRemoteCommand(config.ftpConfig, cleanCommand, '清理');
            }
            await runRemoteCommand(config.ftpConfig, compileCommand, '编译');
        }),

        vscode.commands.registerCommand('ibm-xlc-compile-deploy.deployXLC', async () => {
            const config = getConfig();
            if (!config || !config.ftpConfig) {
                vscode.window.showErrorMessage('配置文件读取失败');
                return;
            }

            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showErrorMessage('请先打开一个编辑的文件以判断发布命令');
                return;
            }
            // 获取TX_BAT_ID
            let deployCommand: string | undefined;
            let TX_BAT_ID = '';
            const fileName = path.basename(editor.document.uri.fsPath, path.extname(editor.document.uri.fsPath)); // 去扩展名的文件名
            if (fileName.toUpperCase().includes('TX')) {
                TX_BAT_ID = fileName.toUpperCase().replace(/\.[^/.]+$/, '').slice(2);
                deployCommand = config.ftpConfig.deployTXCommand;
                if (!deployCommand) {
                    vscode.window.showErrorMessage('deployTXCommand 未配置');
                    return;
                }
            } else if (fileName.toUpperCase().includes('BAT')) {
                TX_BAT_ID = fileName.toUpperCase().replace(/\.[^/.]+$/, '').slice(3);
                deployCommand = config.ftpConfig.deployBATCommand;
                if (!deployCommand) {
                    vscode.window.showErrorMessage('deployBATCommand 未配置');
                    return;
                }
            } else {
                vscode.window.showWarningMessage('无法识别 TX 或 BAT 开头的文件名，无法提取 TX_BAT_ID');
                return;
            }
            deployCommand += " " + TX_BAT_ID;
            await runRemoteCommand(config.ftpConfig, deployCommand, '发布');
        })
    );
}
function convertToUnixLineEndings(filePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        fs.readFile(filePath, 'utf8', (err, data) => {
            if (err) { return reject(err); }
            const unixData = data.replace(/\r\n/g, '\n'); // CRLF -> LF
            fs.writeFile(filePath, unixData, 'utf8', (err) => {
                if (err) { return reject(err); }
                resolve();
            });
        });
    });
}

export function deactivate() { }
