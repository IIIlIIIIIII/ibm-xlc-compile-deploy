"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const ssh2_sftp_client_1 = __importDefault(require("ssh2-sftp-client"));
const ssh2_1 = require("ssh2");
// 输出通道
let outputChannel;
// 日志工具
function log(...messages) {
    const text = messages.map(m => typeof m === 'string' ? m : JSON.stringify(m, null, 2)).join(' ');
    outputChannel.appendLine(text);
}
/**
 * 将本地文件上传至远程服务器 (SFTP)
 */
function uploadFile(localPath, localBase, remoteBase, ftpConfig, workspaceFolder, outputChannel) {
    return __awaiter(this, void 0, void 0, function* () {
        const sftp = new ssh2_sftp_client_1.default();
        const absLocalPath = path.join(workspaceFolder, localPath);
        const relativeToBase = path.relative(localBase, localPath).replace(/\\/g, '/');
        const remotePath = path.posix.join(remoteBase, relativeToBase);
        outputChannel.appendLine(`连接 SFTP 上传文件: ${absLocalPath} -> ${remotePath}`);
        outputChannel.show();
        try {
            yield sftp.connect(ftpConfig);
            yield sftp.put(absLocalPath, remotePath);
            outputChannel.appendLine(`上传完成: ${relativeToBase}`);
            outputChannel.show();
        }
        catch (err) {
            outputChannel.appendLine(`上传失败: ${err}`);
            outputChannel.show();
            throw err;
        }
        finally {
            yield sftp.end();
        }
    });
}
function downloadFile(localPath, localBase, remoteBase, ftpConfig, workspaceFolder, outputChannel) {
    return __awaiter(this, void 0, void 0, function* () {
        const sftp = new ssh2_sftp_client_1.default();
        const absLocalPath = path.join(workspaceFolder, localPath);
        const relativeToBase = path.relative(localBase, localPath).replace(/\\/g, '/');
        const remotePath = path.posix.join(remoteBase, relativeToBase);
        outputChannel.appendLine(`连接 SFTP 下载文件: ${remotePath} -> ${absLocalPath}`);
        outputChannel.show();
        try {
            yield sftp.connect(ftpConfig);
            yield sftp.get(remotePath, absLocalPath);
            outputChannel.appendLine(`下载完成: ${relativeToBase}`);
            outputChannel.show();
        }
        catch (err) {
            outputChannel.appendLine(`下载失败: ${err}`);
            outputChannel.show();
            throw err;
        }
        finally {
            yield sftp.end();
        }
    });
}
function uploadFolder(localFolder, remoteFolder, ftpConfig, workspaceFolder, outputChannel) {
    return __awaiter(this, void 0, void 0, function* () {
        const sftp = new ssh2_sftp_client_1.default();
        yield sftp.connect(ftpConfig);
        const uploadDir = (localDir, remoteDir) => __awaiter(this, void 0, void 0, function* () {
            const absLocalDir = path.join(workspaceFolder, localDir);
            const entries = fs.readdirSync(absLocalDir, { withFileTypes: true });
            try {
                yield sftp.mkdir(remoteDir, true);
                outputChannel.appendLine(`创建远程目录: ${remoteDir}`);
            }
            catch (_) {
                outputChannel.appendLine(`远程目录已存在: ${remoteDir}`);
            }
            for (const entry of entries) {
                const localEntryRel = path.join(localDir, entry.name);
                const absLocalEntryPath = path.join(workspaceFolder, localEntryRel);
                const remoteEntryPath = path.posix.join(remoteDir, entry.name);
                if (entry.isDirectory()) {
                    yield uploadDir(localEntryRel, remoteEntryPath);
                }
                else {
                    outputChannel.appendLine(`上传: ${absLocalEntryPath} -> ${remoteEntryPath}`);
                    yield sftp.put(absLocalEntryPath, remoteEntryPath);
                }
            }
        });
        yield uploadDir(localFolder, remoteFolder);
        outputChannel.appendLine('文件夹上传完成');
        outputChannel.show(true);
        yield sftp.end();
    });
}
/**
 * 执行远程命令 (SSH)
 */
function runRemoteCommands(config, commands, title, outputChannel) {
    return __awaiter(this, void 0, void 0, function* () {
        return new Promise((resolve, reject) => {
            const conn = new ssh2_1.Client();
            outputChannel.appendLine(`[SSH] 开始连接: ${config.username}@${config.host}:${config.port}`);
            outputChannel.show(true);
            let fullOutput = '';
            conn.on('ready', () => {
                outputChannel.appendLine(`[SSH] 连接成功，开始执行命令序列...`);
                conn.shell((err, stream) => {
                    if (err) {
                        outputChannel.appendLine(`[SSH] shell 启动失败: ${err.message}`);
                        conn.end();
                        return reject(err);
                    }
                    stream.on('close', () => {
                        outputChannel.appendLine(`[SSH] 所有命令执行完毕，关闭连接`);
                        conn.end();
                        resolve();
                    }).on('data', (data) => {
                        const text = data.toString();
                        fullOutput += text;
                        outputChannel.append(text);
                    }).stderr.on('data', (data) => {
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
            }).on('error', (err) => {
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
    });
}
function escapeHtml(unsafe) {
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
function convertToUnixLineEndings(filePath) {
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
function asyncHandler(fn) {
    return (...args) => __awaiter(this, void 0, void 0, function* () {
        try {
            yield fn(...args);
        }
        catch (err) {
            outputChannel.appendLine(`❌ 错误: ${err.message}`);
            outputChannel.show();
            vscode.window.showErrorMessage(`发生错误: ${err.message}`);
        }
    });
}
function activate(context) {
    var _a, _b;
    outputChannel = vscode.window.createOutputChannel('XLC Deploy');
    const workspaceFolder = (_b = (_a = vscode.workspace.workspaceFolders) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.uri.fsPath;
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('请先打开一个工作区');
        return;
    }
    const configPath = path.join(workspaceFolder, '.vscode', 'ftp-mappings.json');
    const ensureConfigFile = () => {
        if (!fs.existsSync(configPath)) {
            const defaultPath = '/home/defaultCompilePath';
            const defaultConfig = {
                localConfig: {
                    src: 'src',
                    inc: 'inc',
                    mak: 'mak',
                    mq: 'mq'
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
                    remoteMq: `${defaultPath}/mq`,
                    compileTXCommand: `cd ${defaultPath}/mak && ./buildTX.sh`,
                    compileBATCommand: `cd ${defaultPath}/mak && ./buildBAT.sh`,
                    deployTXCommand: `cd ${defaultPath} && ./deployTX.ksh`,
                    deployBATCommand: `cd ${defaultPath} && ./deployBAT.ksh`
                }
            };
            fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
            vscode.window.showInformationMessage('✅ 已生成默认 ftp-mappings.json 配置文件');
        }
    };
    const getConfig = () => {
        if (!fs.existsSync(configPath)) {
            vscode.window.showErrorMessage('ftp-mappings.json 不存在');
            return null;
        }
        return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    };
    const config = getConfig();
    if (!config || !config.ftpConfig)
        return;
    vscode.window.showInformationMessage('✅ XLC 编译部署插件已激活');
    const { localConfig, ftpConfig } = config;
    const vscodeconfig = vscode.workspace.getConfiguration('ibm-xlc-compile-deploy');
    const autoSshConnect = vscodeconfig.get('autoSshConnect', false);
    if (autoSshConnect) {
        let sshCommand = `ssh `;
        if (ftpConfig.port && ftpConfig.port !== 22) {
            sshCommand += `-p ${ftpConfig.port} `;
        }
        sshCommand += `${ftpConfig.username}@${ftpConfig.host}`;
        // 创建终端并自动执行 ssh 命令
        const terminal = vscode.window.createTerminal(`SSH Terminal`);
        terminal.sendText(sshCommand);
        terminal.show();
        vscode.window.showInformationMessage('✅ 终端已自动SSH连接远程服务器');
    }
    context.subscriptions.push(
    // 配置映射
    vscode.commands.registerCommand('ibm-xlc-compile-deploy.configureMappings', asyncHandler(() => __awaiter(this, void 0, void 0, function* () {
        ensureConfigFile();
        const doc = yield vscode.workspace.openTextDocument(configPath);
        yield vscode.window.showTextDocument(doc);
    }))), 
    // 手动上传当前文件
    vscode.commands.registerCommand('ibm-xlc-compile-deploy.upload', asyncHandler(() => __awaiter(this, void 0, void 0, function* () {
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
        const confirmUpload = yield vscode.window.showWarningMessage(`是否上传本地文件: ${relativePath}`, { modal: true }, '是');
        if (confirmUpload !== '是') {
            return;
        }
        if (relativePath.startsWith(localConfig.src)) {
            yield uploadFile(relativePath, localConfig.src, ftpConfig.remoteSrc, ftpConfig, workspaceFolder, outputChannel);
            vscode.window.showInformationMessage('✅ src 当前文件上传完成');
        }
        else if (relativePath.startsWith(localConfig.mak)) {
            yield convertToUnixLineEndings(currentFilePath);
            yield uploadFile(relativePath, localConfig.mak, ftpConfig.remoteMak, ftpConfig, workspaceFolder, outputChannel);
            vscode.window.showInformationMessage('✅ mak 当前文件上传完成');
        }
        else if (relativePath.startsWith(localConfig.inc)) {
            yield uploadFile(relativePath, localConfig.inc, ftpConfig.remoteInc, ftpConfig, workspaceFolder, outputChannel);
            vscode.window.showInformationMessage('✅ inc 当前文件上传完成');
        }
        else if (relativePath.startsWith(localConfig.mq)) {
            yield uploadFile(relativePath, localConfig.mq, ftpConfig.remoteMq, ftpConfig, workspaceFolder, outputChannel);
            vscode.window.showInformationMessage('✅ mq 当前文件上传完成');
        }
        else {
            vscode.window.showWarningMessage('⚠️ 当前文件不在配置映射路径中');
        }
    }))), 
    // 手动下载服务器上当前文件
    vscode.commands.registerCommand('ibm-xlc-compile-deploy.download', asyncHandler(() => __awaiter(this, void 0, void 0, function* () {
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
        const confirmUpload = yield vscode.window.showWarningMessage(`是否下载服务器文件: ${relativePath}`, { modal: true }, '是');
        if (confirmUpload !== '是') {
            return;
        }
        if (relativePath.startsWith(localConfig.src)) {
            yield downloadFile(relativePath, localConfig.src, ftpConfig.remoteSrc, ftpConfig, workspaceFolder, outputChannel);
            vscode.window.showInformationMessage('✅ src 当前文件下载完成');
        }
        else if (relativePath.startsWith(localConfig.mak)) {
            yield convertToUnixLineEndings(currentFilePath);
            yield downloadFile(relativePath, localConfig.mak, ftpConfig.remoteMak, ftpConfig, workspaceFolder, outputChannel);
            vscode.window.showInformationMessage('✅ mak 当前文件下载完成');
        }
        else if (relativePath.startsWith(localConfig.inc)) {
            yield downloadFile(relativePath, localConfig.inc, ftpConfig.remoteInc, ftpConfig, workspaceFolder, outputChannel);
            vscode.window.showInformationMessage('✅ inc 当前文件下载完成');
        }
        else if (relativePath.startsWith(localConfig.mq)) {
            yield downloadFile(relativePath, localConfig.mq, ftpConfig.remoteMq, ftpConfig, workspaceFolder, outputChannel);
            vscode.window.showInformationMessage('✅ mq 当前文件下载完成');
        }
        else {
            vscode.window.showWarningMessage('⚠️ 当前文件不在配置映射路径中');
        }
    }))), 
    // 编译命令
    vscode.commands.registerCommand('ibm-xlc-compile-deploy.compileXLC', asyncHandler(() => __awaiter(this, void 0, void 0, function* () {
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
            deployCommand = ftpConfig.deployTXCommand + ` ${TX_BAT_ID}`;
        }
        else if (fileName.toUpperCase().startsWith('BAT')) {
            TX_BAT_ID = fileName.slice(3).toUpperCase();
            compileCommand = `${ftpConfig.compileBATCommand} bat${TX_BAT_ID}.mak`;
            deployCommand = ftpConfig.deployBATCommand + ` BAT${TX_BAT_ID}`;
        }
        else {
            vscode.window.showWarningMessage('⚠️ 无法识别 TX 或 BAT 开头的文件名');
            return;
        }
        // 上传 inc 文件夹
        if (localConfig.inc && ftpConfig.remoteInc) {
            const confirmInc = yield vscode.window.showWarningMessage('是否上传 inc 文件夹？', { modal: true }, '否', '是');
            if (confirmInc === '是') {
                yield uploadFolder(localConfig.inc, ftpConfig.remoteInc, ftpConfig, workspaceFolder, outputChannel);
                vscode.window.showInformationMessage('✅ inc 文件夹上传完成');
            }
            else if (confirmInc !== '否') {
                return;
            }
        }
        // 上传 src 中匹配的文件
        if (localConfig.src && ftpConfig.remoteSrc) {
            const srcFiles = fs.readdirSync(path.join(workspaceFolder, localConfig.src));
            for (const file of srcFiles) {
                if (file.toUpperCase().includes(TX_BAT_ID)) {
                    const relativePath = path.join(localConfig.src, file);
                    yield uploadFile(relativePath, localConfig.src, ftpConfig.remoteSrc, ftpConfig, workspaceFolder, outputChannel);
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
                    yield convertToUnixLineEndings(absLocalPath);
                    const relativePath = path.join(localConfig.mak, file);
                    yield uploadFile(relativePath, localConfig.mak, ftpConfig.remoteMak, ftpConfig, workspaceFolder, outputChannel);
                }
            }
            vscode.window.showInformationMessage(`✅ mak 中包含 ${TX_BAT_ID} 的文件已上传`);
        }
        let commands = [];
        const confirmClean = yield vscode.window.showWarningMessage('是否清理？', { modal: true }, '否', '是');
        if (confirmClean === '是') {
            commands.push(compileCommand + ' clean');
        }
        else if (confirmClean !== '否') {
            return;
        }
        commands.push(compileCommand);
        if (commands.length > 0) {
            yield runRemoteCommands(ftpConfig, commands, '清理-编译-部署', outputChannel);
        }
        commands = []; // 清空命令
        const confirmDeploy = yield vscode.window.showWarningMessage(`是否部署${fileName}？`, { modal: true }, '否', '是');
        if (confirmDeploy === '是') {
            commands.push(deployCommand);
        }
        else if (confirmDeploy !== '否') {
            return;
        }
        if (commands.length > 0) {
            yield runRemoteCommands(ftpConfig, commands, '清理-编译-部署', outputChannel);
        }
        outputChannel.appendLine(`>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>`);
        outputChannel.appendLine(`>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>`);
        outputChannel.appendLine(`>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>`);
        outputChannel.show(true);
    }))), 
    // 部署命令
    vscode.commands.registerCommand('ibm-xlc-compile-deploy.deployXLC', asyncHandler(() => __awaiter(this, void 0, void 0, function* () {
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
            deployCommand = config.ftpConfig.deployTXCommand + ` ${TX_BAT_ID}`;
        }
        else if (fileName.toUpperCase().startsWith('BAT')) {
            TX_BAT_ID = fileName.slice(3).toUpperCase();
            deployCommand = config.ftpConfig.deployBATCommand + ` BAT${TX_BAT_ID}`;
        }
        else {
            vscode.window.showWarningMessage('⚠️ 无法识别 TX 或 BAT 开头的文件名');
            return;
        }
        const commands = [];
        const confirmDeploy = yield vscode.window.showWarningMessage(`是否部署${fileName}？`, { modal: true }, '确认');
        if (confirmDeploy === '确认') {
            commands.push(deployCommand);
        }
        else {
            return;
        }
        if (commands.length > 0) {
            yield runRemoteCommands(config.ftpConfig, commands, '部署', outputChannel);
        }
        outputChannel.appendLine(`>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>`);
        outputChannel.appendLine(`>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>`);
        outputChannel.appendLine(`>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>`);
        outputChannel.show(true);
    }))));
}
exports.activate = activate;
