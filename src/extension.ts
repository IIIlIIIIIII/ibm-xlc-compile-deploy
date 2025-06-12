import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

import SftpClient from 'ssh2-sftp-client';
import { Client } from 'ssh2';

// 输出通道
let outputChannel: vscode.OutputChannel;

// 日志工具
function log(...messages: any[]) {
    const text = messages.map(m => typeof m === 'string' ? m : JSON.stringify(m, null, 2)).join(' ');
    outputChannel.appendLine(text);
}

type FtpConfig = {
    host: string;
    port: number;
    username: string;
    password: string;
    privateKey?: string; // 可选私钥路径或内容
    remoteSrc: string;
    remoteInc: string;
    remoteMak: string;
    compileTXCommand: string;
    compileBATCommand: string;
    deployTXCommand: string;
    deployBATCommand: string;
};

type SSHConfig = FtpConfig;

/**
 * 将本地文件上传至远程服务器 (SFTP)
 */
async function uploadFile(
    localPath: string,
    localBase: string,
    remoteBase: string,
    ftpConfig: FtpConfig,
    workspaceFolder: string,
    outputChannel: vscode.OutputChannel
) {
    const sftp = new SftpClient();
    const absLocalPath = path.join(workspaceFolder, localPath);
    const relativeToBase = path.relative(localBase, localPath).replace(/\\/g, '/');
    const remotePath = path.posix.join(remoteBase, relativeToBase);

    outputChannel.appendLine(`连接 SFTP 上传文件: ${absLocalPath} -> ${remotePath}`);

    try {
        await sftp.connect(ftpConfig);
        await sftp.put(absLocalPath, remotePath);
        outputChannel.appendLine(`上传完成: ${remotePath}`);
    } catch (err) {
        outputChannel.appendLine(`上传失败: ${err}`);
        throw err;
    } finally {
        await sftp.end();
    }
}

/**
 * 递归上传整个本地文件夹到远程 (SFTP)
 */
// 强制断言 sftp 实例支持 mkdir 方法
interface ExtendedSftpClient extends SftpClient {
    mkdir(path: string, recursive?: boolean): Promise<void>;
}

async function uploadFolder(
    localFolder: string,
    remoteFolder: string,
    ftpConfig: FtpConfig,
    workspaceFolder: string,
    outputChannel: vscode.OutputChannel
) {
    const sftp = new SftpClient() as ExtendedSftpClient;

    await sftp.connect(ftpConfig);

    const uploadDir = async (localDir: string, remoteDir: string) => {
        const absLocalDir = path.join(workspaceFolder, localDir);
        const entries = fs.readdirSync(absLocalDir, { withFileTypes: true });

        try {
            await sftp.mkdir(remoteDir, true);
            outputChannel.appendLine(`创建远程目录: ${remoteDir}`);
        } catch (_) {
            outputChannel.appendLine(`远程目录已存在: ${remoteDir}`);
        }

        for (const entry of entries) {
            const localEntryRel = path.join(localDir, entry.name);
            const absLocalEntryPath = path.join(workspaceFolder, localEntryRel);
            const remoteEntryPath = path.posix.join(remoteDir, entry.name);

            if (entry.isDirectory()) {
                await uploadDir(localEntryRel, remoteEntryPath);
            } else {
                outputChannel.appendLine(`上传: ${absLocalEntryPath} -> ${remoteEntryPath}`);
                await sftp.put(absLocalEntryPath, remoteEntryPath);
            }
        }
    };

    await uploadDir(localFolder, remoteFolder);
    outputChannel.appendLine('文件夹上传完成');
    outputChannel.show(true);
    await sftp.end();
}

/**
 * 执行远程命令 (SSH)
 */
async function runRemoteCommands(
    config: SSHConfig,
    commands: string[],
    title: string,
    outputChannel: vscode.OutputChannel
): Promise<void> {
    return new Promise((resolve, reject) => {
        const conn = new Client();

        outputChannel.appendLine(`[SSH] 开始连接: ${config.username}@${config.host}:${config.port}`);
        outputChannel.show(true);

        let fullOutput = '';

        conn.on('ready', () => {
            outputChannel.appendLine(`[SSH] 连接成功，开始执行命令序列...`);

            (conn as any).shell((err: Error | null, stream: any) => {
                if (err) {
                    outputChannel.appendLine(`[SSH] shell 启动失败: ${err.message}`);
                    conn.end();
                    return reject(err);
                }

                stream.on('close', () => {
                    outputChannel.appendLine(`[SSH] 所有命令执行完毕，关闭连接`);
                    conn.end();
                    resolve();
                }).on('data', (data: Buffer) => {
                    const text = data.toString();
                    fullOutput += text;
                    outputChannel.append(text);
                }).stderr.on('data', (data: Buffer) => {
                    const errText = data.toString();
                    fullOutput += errText;
                    outputChannel.append(`ERR: ${errText}`);
                });

                // 执行命令队列
                for (const cmd of commands) {
                    stream.write(`${cmd}\n`);
                }
                stream.write('exit\n');
            });
        }).on('error', (err: Error) => {
            outputChannel.appendLine(`[SSH] 连接错误: ${err.message}`);
            reject(err);
        }).connect({
            host: config.host,
            port: config.port || 22,
            username: config.username,
            password: config.password,
            privateKey: config.privateKey,
            tryKeyboard: true
        });
    });
}

function escapeHtml(unsafe: string): string {
    return unsafe.replace(/[&<>"']/g, (m) => {
        switch (m) {
            case '&': return '&amp;';
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '"': return '&quot;';
            case '\'': return '&#039;';
            default: return m;
        }
    });
}

// 转换为 Unix 换行符
function convertToUnixLineEndings(filePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        fs.readFile(filePath, 'utf8', (err, data) => {
            if (err) {
                return reject(err);
            }
            const unixData = data.replace(/\r\n/g, '\n');
            fs.writeFile(filePath, unixData, 'utf8', (writeErr) => {
                if (writeErr) {
                    return reject(writeErr);
                }
                resolve();
            });
        });
    });
}

// 统一异常处理包装器
function asyncHandler(fn: (...args: any[]) => Promise<any>) {
    return async (...args: any[]) => {
        try {
            await fn(...args);
        } catch (err: any) {
            outputChannel.appendLine(`❌ 错误: ${err.message}`);
            outputChannel.show();
            vscode.window.showErrorMessage(`发生错误: ${err.message}`);
        }
    };
}

export function activate(context: vscode.ExtensionContext) {
    outputChannel = vscode.window.createOutputChannel('XLC Deploy');

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('请先打开一个工作区');
        return;
    }

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
                    port: 22,
                    username: 'ftpuser',
                    password: 'ftppassword',
                    privateKey: '',

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
            vscode.window.showInformationMessage('✅ 已生成默认 .ftp-mappings.json 配置文件');
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
        // 配置映射
        vscode.commands.registerCommand('ibm-xlc-compile-deploy.configureMappings', asyncHandler(async () => {
            ensureConfigFile();
            const doc = await vscode.workspace.openTextDocument(configPath);
            await vscode.window.showTextDocument(doc);
        })),

        // 手动上传当前文件
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
            const confirmUpload = await vscode.window.showWarningMessage(`是否上传本地文件: ${relativePath}`,{ modal: true },'是');
            if (confirmUpload !== '是') {
                return;
            }
            if (relativePath.startsWith(localConfig.src)) {
                await uploadFile(relativePath, localConfig.src, ftpConfig.remoteSrc, ftpConfig, workspaceFolder, outputChannel);
                vscode.window.showInformationMessage('✅ src 当前文件上传完成');
            } else if (relativePath.startsWith(localConfig.mak)) {
                await convertToUnixLineEndings(currentFilePath);
                await uploadFile(relativePath, localConfig.mak, ftpConfig.remoteMak, ftpConfig, workspaceFolder, outputChannel);
                vscode.window.showInformationMessage('✅ mak 当前文件上传完成');
            } else if (relativePath.startsWith(localConfig.inc)) {
                await uploadFile(relativePath, localConfig.inc, ftpConfig.remoteInc, ftpConfig, workspaceFolder, outputChannel);
                vscode.window.showInformationMessage('✅ inc 当前文件上传完成');
            } else {
                vscode.window.showWarningMessage('⚠️ 当前文件不在 src、mak、inc 中');
            }
        })),

        // 编译命令
        vscode.commands.registerCommand('ibm-xlc-compile-deploy.compileXLC', asyncHandler(async () => {
            const config = getConfig();
            if (!config || !config.ftpConfig) return;
            const { localConfig, ftpConfig } = config;

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
                deployCommand = ftpConfig.deployTXCommand;
            } else if (fileName.toUpperCase().startsWith('BAT')) {
                TX_BAT_ID = fileName.slice(3).toUpperCase();
                compileCommand = `${ftpConfig.compileBATCommand} bat${TX_BAT_ID}.mak`;
                deployCommand = ftpConfig.deployBATCommand;
            } else {
                vscode.window.showWarningMessage('⚠️ 无法识别 TX 或 BAT 开头的文件名');
                return;
            }

            // 上传 inc 文件夹
            if (localConfig.inc && ftpConfig.remoteInc) {
                const confirmInc = await vscode.window.showWarningMessage('是否上传 inc 文件夹？', { modal: true }, '否', '是');
                if (confirmInc === '是') {
                    await uploadFolder(localConfig.inc, ftpConfig.remoteInc, ftpConfig, workspaceFolder, outputChannel);
                    vscode.window.showInformationMessage('✅ inc 文件夹上传完成');
                } else if (confirmInc !== '否') {
                    return;
                }
            }

            // 上传 src 中匹配的文件
            if (localConfig.src && ftpConfig.remoteSrc) {
                const srcFiles = fs.readdirSync(path.join(workspaceFolder, localConfig.src));
                for (const file of srcFiles) {
                    if (file.toUpperCase().includes(TX_BAT_ID)) {
                        const relativePath = path.join(localConfig.src, file);
                        await uploadFile(relativePath, localConfig.src, ftpConfig.remoteSrc, ftpConfig, workspaceFolder, outputChannel);
                    }
                }
                vscode.window.showInformationMessage(`✅ src 中包含 ${TX_BAT_ID} 的文件已上传`);
            }

            // 上传 mak 中匹配的文件
            if (localConfig.mak && ftpConfig.remoteMak) {
                const makFiles = fs.readdirSync(path.join(workspaceFolder, localConfig.mak));
                for (const file of makFiles) {
                    const upper = file.toUpperCase();
                    if (upper.includes(TX_BAT_ID) || upper === 'TX_LIST.MAK') {
                        const absLocalPath = path.join(workspaceFolder, localConfig.mak, file);
                        await convertToUnixLineEndings(absLocalPath);
                        const relativePath = path.join(localConfig.mak, file);
                        await uploadFile(relativePath, localConfig.mak, ftpConfig.remoteMak, ftpConfig, workspaceFolder, outputChannel);
                    }
                }
                vscode.window.showInformationMessage(`✅ mak 中包含 ${TX_BAT_ID} 的文件已上传`);
            }

            let commands: string[] = [];
            const confirmClean = await vscode.window.showWarningMessage('是否清理？', { modal: true }, '否', '是');
            if (confirmClean === '是') {
                commands.push(compileCommand + ' clean');
            }
            commands.push(compileCommand);
            if (commands.length > 0) {
                await runRemoteCommands(ftpConfig, commands, '清理-编译-部署', outputChannel);
            }
            commands = []; // 清空命令
            const confirmDeploy = await vscode.window.showWarningMessage('是否部署？', { modal: true }, '否', '是');
            if (confirmDeploy === '是') {
                commands.push(deployCommand + ` ${TX_BAT_ID}`);
            }

            if (commands.length > 0) {
                await runRemoteCommands(ftpConfig, commands, '清理-编译-部署', outputChannel);
            }
            outputChannel.appendLine(`>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>`);
            outputChannel.appendLine(`>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>`);
            outputChannel.appendLine(`>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>`);
            outputChannel.show(true);
        })),

        // 部署命令
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
                vscode.window.showWarningMessage('⚠️ 无法识别 TX 或 BAT 开头的文件名');
                return;
            }

            deployCommand += ` ${TX_BAT_ID}`;
            const commands: string[] = [];
            const confirmDeploy = await vscode.window.showWarningMessage('是否部署？', { modal: true }, '确认');
            if (confirmDeploy === '确认') {
                commands.push(deployCommand + ` ${TX_BAT_ID}`);
            } else {
                return;
            }
            if (commands.length > 0) {
                await runRemoteCommands(config.ftpConfig, commands, '部署', outputChannel);
            }
            outputChannel.appendLine(`>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>`);
            outputChannel.appendLine(`>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>`);
            outputChannel.appendLine(`>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>`);
            outputChannel.show(true);
        }))
    );

    vscode.window.showInformationMessage('✅ XLC 编译部署插件已激活');
}