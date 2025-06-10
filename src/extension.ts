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
    const outputChannel = vscode.window.createOutputChannel('XLC Deploy');

    const configPath = path.join(workspaceFolder, '.ftp-mappings.json');

    const ensureConfigFile = () => {
        if (!fs.existsSync(configPath)) {
            const defaultPath = '/home/defaultCompilePath';
            const defaultConfig = {
                localConfig: {
                    src: 'src',
                    inc: 'inc',
                    mak: 'mak'
                },
                ftpConfig: {
                    host: 'your.ftp.server',
                    port: 21,
                    username: 'ftpuser',
                    password: 'ftppassword',

                    remoteSrc: `${defaultPath}/src`,
                    remoteInc: `${defaultPath}/inc`,
                    remoteMak: `${defaultPath}/mak`,

                    compileTXCommand: `cd ${defaultPath}/mak && ./buildTX.sh`,
                    compileBATCommand: `cd ${defaultPath}/mak && ./buildBAT.sh`,
                    deployTXCommand: `cd ${defaultPath} && ./deployTX.ksh`,
                    deployBATCommand: `cd ${defaultPath} && ./deployBAT.ksh`
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

    const asyncHandler = (fn: (...args: any[]) => Promise<any>) => {
        return async (...args: any[]) => {
            try {
                await fn(...args);
            } catch (err) {
                outputChannel.appendLine('命令执行失败:' +  err);
                outputChannel.show();
                vscode.window.showErrorMessage('发生错误，请查看控制台日志');
            }
        };
    };

    ensureConfigFile();

    context.subscriptions.push(
        vscode.commands.registerCommand('ibm-xlc-compile-deploy.configureMappings', asyncHandler(async () => {
            ensureConfigFile();
            const doc = await vscode.workspace.openTextDocument(configPath);
            await vscode.window.showTextDocument(doc);
        })),

        vscode.commands.registerCommand('ibm-xlc-compile-deploy.upload', asyncHandler(async () => {
            const config = getConfig();
            if (!config || !config.ftpConfig) return;
            const { localConfig, ftpConfig } = config;

            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showErrorMessage('请先打开一个编辑的文件');
                return;
            }

            const currentFilePath = editor.document.uri.fsPath;
            const relativePath = path.relative(workspaceFolder, currentFilePath).replace(/\\/g, '/');

            outputChannel.appendLine('当前文件: ' + currentFilePath);
            outputChannel.appendLine('相对路径: ' + relativePath);
            outputChannel.appendLine('工作区: ' + workspaceFolder);
            outputChannel.show();

            if (relativePath.startsWith(localConfig.src)) {
                await uploadFile(relativePath, localConfig.src, ftpConfig.remoteSrc, ftpConfig, workspaceFolder, outputChannel);
                vscode.window.showInformationMessage('src 当前文件上传完成');
            } else if (relativePath.startsWith(localConfig.mak)) {
                await convertToUnixLineEndings(currentFilePath);
                await uploadFile(relativePath, localConfig.mak, ftpConfig.remoteMak, ftpConfig, workspaceFolder, outputChannel);
                vscode.window.showInformationMessage('mak 当前文件上传完成');
            } else if (relativePath.startsWith(localConfig.inc)) {
                await uploadFile(relativePath, localConfig.inc, ftpConfig.remoteInc, ftpConfig, workspaceFolder, outputChannel);
                vscode.window.showInformationMessage('inc 当前文件上传完成');
            } else {
                vscode.window.showWarningMessage('当前文件不在 src、mak、inc 中');
            }
        })),

        vscode.commands.registerCommand('ibm-xlc-compile-deploy.compileXLC', asyncHandler(async () => {
            const config = getConfig();
            if (!config || !config.ftpConfig) return;

            const { localConfig, ftpConfig } = config;

            if (localConfig.inc && ftpConfig.remoteInc) {
                const confirmInc = await vscode.window.showWarningMessage('是否跳过上传 inc 文件夹（会覆盖远程内容）？', { modal: true }, '确认');
                if (confirmInc !== '确认') {
                    await uploadFolder(localConfig.inc, ftpConfig.remoteInc, ftpConfig, workspaceFolder, outputChannel);
                    vscode.window.showInformationMessage('inc 文件夹上传完成');
                }
            }

            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showErrorMessage('请先打开一个编辑的文件以判断编译命令');
                return;
            }

            const fileName = path.basename(editor.document.uri.fsPath, path.extname(editor.document.uri.fsPath));
            let TX_BAT_ID = '';
            let compileCommand = '';
            let deployCommand = '';

            if (fileName.toUpperCase().startsWith('TX')) {
                TX_BAT_ID = fileName.slice(2).toUpperCase();
                compileCommand = `${ftpConfig.compileTXCommand} tx${TX_BAT_ID}.mak`;
                deployCommand = config.ftpConfig.deployTXCommand;
            } else if (fileName.toUpperCase().startsWith('BAT')) {
                TX_BAT_ID = fileName.slice(3).toUpperCase();
                compileCommand = `${ftpConfig.compileBATCommand} bat${TX_BAT_ID}.mak`;
                deployCommand = config.ftpConfig.deployBATCommand;
            } else {
                vscode.window.showWarningMessage('无法识别 TX 或 BAT 开头的文件名');
                return;
            }

            // 上传 src
            if (localConfig.src && ftpConfig.remoteSrc) {
                const srcFiles = fs.readdirSync(path.join(workspaceFolder, localConfig.src));
                for (const file of srcFiles) {
                    if (file.toUpperCase().includes(TX_BAT_ID)) {
                        const relativePath = path.join(localConfig.src, file);
                        await uploadFile(relativePath, localConfig.src, ftpConfig.remoteSrc, ftpConfig, workspaceFolder, outputChannel);
                    }
                }
                vscode.window.showInformationMessage(`src 中包含 ${TX_BAT_ID} 的文件已上传`);
            }

            // 上传 mak
            if (localConfig.mak && ftpConfig.remoteMak) {
                const makFiles = fs.readdirSync(path.join(workspaceFolder, localConfig.mak));
                for (const file of makFiles) {
                    const upper = file.toUpperCase();
                    if (upper.includes(TX_BAT_ID) || upper === 'TX_LIST.MAK') {
                        const absLocalPath = path.join(workspaceFolder, localConfig.mak);
                        await convertToUnixLineEndings(path.join(absLocalPath, file));
                        const relativePath = path.join(localConfig.mak, file);
                        await uploadFile(relativePath, localConfig.mak, ftpConfig.remoteMak, ftpConfig, workspaceFolder, outputChannel);
                    }
                }
                vscode.window.showInformationMessage(`mak 中包含 ${TX_BAT_ID} 的文件已上传`);
            }

            const confirmClean = await vscode.window.showWarningMessage('是否clean？', { modal: true }, '确认');
            if (confirmClean === '确认') {
                await runRemoteCommand(ftpConfig, compileCommand + ' clean', '清理', outputChannel);
            }
            await runRemoteCommand(ftpConfig, compileCommand, '编译', outputChannel);
            const confirmDeploy = await vscode.window.showWarningMessage('是否部署？', { modal: true }, '确认');
            if (confirmDeploy === '确认') {
                deployCommand += ` ${TX_BAT_ID}`;
                await runRemoteCommand(config.ftpConfig, deployCommand, '部署', outputChannel);
            }
        })),

        vscode.commands.registerCommand('ibm-xlc-compile-deploy.deployXLC', asyncHandler(async () => {
            const config = getConfig();
            if (!config || !config.ftpConfig) return;

            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showErrorMessage('请先打开一个编辑的文件以判断部署命令');
                return;
            }

            const fileName = path.basename(editor.document.uri.fsPath, path.extname(editor.document.uri.fsPath));
            let TX_BAT_ID = '';
            let deployCommand = '';

            if (fileName.toUpperCase().startsWith('TX')) {
                TX_BAT_ID = fileName.slice(2).toUpperCase();
                deployCommand = config.ftpConfig.deployTXCommand;
            } else if (fileName.toUpperCase().startsWith('BAT')) {
                TX_BAT_ID = fileName.slice(3).toUpperCase();
                deployCommand = config.ftpConfig.deployBATCommand;
            } else {
                vscode.window.showWarningMessage('无法识别 TX 或 BAT 开头的文件名');
                return;
            }

            deployCommand += ` ${TX_BAT_ID}`;
            await runRemoteCommand(config.ftpConfig, deployCommand, '发布', outputChannel);
        }))
    );
}

function convertToUnixLineEndings(filePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        fs.readFile(filePath, 'utf8', (err, data) => {
            if (err) return reject(err);
            const unixData = data.replace(/\r\n/g, '\n');
            fs.writeFile(filePath, unixData, 'utf8', (err) => {
                if (err) return reject(err);
                resolve();
            });
        });
    });
}

export function deactivate() {}
