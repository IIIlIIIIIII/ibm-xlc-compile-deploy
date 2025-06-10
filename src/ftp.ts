import SftpClient from 'ssh2-sftp-client';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

const outputChannel = vscode.window.createOutputChannel('XLC Deploy');

type FtpConfig = {
    host: string;
    port: number;
    username: string;
    password: string;
};

function log(...messages: any[]) {
    const text = messages.map(m => typeof m === 'string' ? m : JSON.stringify(m, null, 2)).join(' ');
    outputChannel.appendLine(text);
}

export async function uploadFile(
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

export async function uploadFolder(
    localFolder: string,
    remoteFolder: string,
    ftpConfig: FtpConfig,
    workspaceFolder: string,
    outputChannel: vscode.OutputChannel // 新增参数
) {
    const sftp = new SftpClient();
    await sftp.connect(ftpConfig);

    const uploadDir = async (localDir: string, remoteDir: string) => {
        const absLocalDir = path.join(workspaceFolder, localDir);
        const entries = fs.readdirSync(absLocalDir, { withFileTypes: true });

        try {
            await sftp.mkdir(remoteDir, true);
            outputChannel.appendLine(`创建远程目录: ${remoteDir}`);
            outputChannel.show(true);
        } catch (_) {
            outputChannel.appendLine(`远程目录已存在: ${remoteDir}`);
            outputChannel.show(true);
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

