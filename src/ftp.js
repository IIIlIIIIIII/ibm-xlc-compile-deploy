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
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadFile = uploadFile;
exports.uploadFolder = uploadFolder;
const ssh2_sftp_client_1 = __importDefault(require("ssh2-sftp-client"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const outputChannel = vscode.window.createOutputChannel('XLC Deploy');
function log(...messages) {
    const text = messages.map(m => typeof m === 'string' ? m : JSON.stringify(m, null, 2)).join(' ');
    outputChannel.appendLine(text);
}
async function uploadFile(localPath, localBase, remoteBase, ftpConfig, workspaceFolder, outputChannel) {
    const sftp = new ssh2_sftp_client_1.default();
    const absLocalPath = path.join(workspaceFolder, localPath);
    const relativeToBase = path.relative(localBase, localPath).replace(/\\/g, '/');
    const remotePath = path.posix.join(remoteBase, relativeToBase);
    outputChannel.appendLine(`连接 SFTP 上传文件: ${absLocalPath} -> ${remotePath}`);
    try {
        await sftp.connect(ftpConfig);
        await sftp.put(absLocalPath, remotePath);
        outputChannel.appendLine(`上传完成: ${remotePath}`);
    }
    catch (err) {
        outputChannel.appendLine(`上传失败: ${err}`);
        throw err;
    }
    finally {
        await sftp.end();
    }
}
async function uploadFolder(localFolder, remoteFolder, ftpConfig, workspaceFolder, outputChannel // 新增参数
) {
    const sftp = new ssh2_sftp_client_1.default();
    await sftp.connect(ftpConfig);
    const uploadDir = async (localDir, remoteDir) => {
        const absLocalDir = path.join(workspaceFolder, localDir);
        const entries = fs.readdirSync(absLocalDir, { withFileTypes: true });
        try {
            await sftp.mkdir(remoteDir, true);
            outputChannel.appendLine(`创建远程目录: ${remoteDir}`);
            outputChannel.show(true);
        }
        catch (_) {
            outputChannel.appendLine(`远程目录已存在: ${remoteDir}`);
            outputChannel.show(true);
        }
        for (const entry of entries) {
            const localEntryRel = path.join(localDir, entry.name);
            const absLocalEntryPath = path.join(workspaceFolder, localEntryRel);
            const remoteEntryPath = path.posix.join(remoteDir, entry.name);
            if (entry.isDirectory()) {
                await uploadDir(localEntryRel, remoteEntryPath);
            }
            else {
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
//# sourceMappingURL=ftp.js.map