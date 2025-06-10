import SftpClient from 'ssh2-sftp-client';
import * as fs from 'fs';
import * as path from 'path';

type FtpConfig = {
    host: string;
    port: number;
    username: string;
    password: string;
};

export async function uploadFile(
    localPath: string,
    localBase: string,
    remoteBase: string,
    ftpConfig: FtpConfig,
    workspaceFolder: string
) {
    const sftp = new SftpClient();

    // 转换为绝对路径
    const absLocalPath = path.join(workspaceFolder, localPath);
    const relativeToBase = path.relative(localBase, localPath).replace(/\\/g, '/');
    const remotePath = path.posix.join(remoteBase, relativeToBase);

    await sftp.connect(ftpConfig);
    await sftp.put(absLocalPath, remotePath);
    await sftp.end();
}

export async function uploadFolder(
    localFolder: string,
    remoteFolder: string,
    ftpConfig: FtpConfig,
    workspaceFolder: string
) {
    const sftp = new SftpClient();
    await sftp.connect(ftpConfig);

    const uploadDir = async (localDir: string, remoteDir: string) => {
        const absLocalDir = path.join(workspaceFolder, localDir);
        const entries = fs.readdirSync(absLocalDir, { withFileTypes: true });

        try {
            await sftp.mkdir(remoteDir, true);
        } catch (_) { }

        for (const entry of entries) {
            const localEntryRel = path.join(localDir, entry.name); // 相对路径，递归用
            const absLocalEntryPath = path.join(workspaceFolder, localEntryRel);
            const remoteEntryPath = path.posix.join(remoteDir, entry.name);

            if (entry.isDirectory()) {
                await uploadDir(localEntryRel, remoteEntryPath);
            } else {
                await sftp.put(absLocalEntryPath, remoteEntryPath);
            }
        }
    };

    await uploadDir(localFolder, remoteFolder);
    await sftp.end();
}
