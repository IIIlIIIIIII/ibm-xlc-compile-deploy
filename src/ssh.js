"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runRemoteCommand = runRemoteCommand;
const ssh2_1 = require("ssh2");
/**
 * 通过SSH执行远程命令（伪终端模式），将输出写入传入的 outputChannel，
 * 并在命令执行结束后以Webview面板方式展示完整结果
 * @param config SSH连接配置
 * @param command 远程执行的命令
 * @param title 用于Webview面板标题
 * @param outputChannel VSCode统一输出通道
 */
async function runRemoteCommand(config, command, title, outputChannel) {
    return new Promise((resolve, reject) => {
        const conn = new ssh2_1.Client();
        outputChannel.appendLine(`[SSH] 开始连接: ${config.username}@${config.host}:${config.port}`);
        outputChannel.show(true);
        let fullOutput = ''; // 缓存所有输出内容
        conn.on('ready', () => {
            outputChannel.appendLine(`[SSH] 连接成功，执行命令: ${command}`);
            conn.shell((err, stream) => {
                if (err) {
                    outputChannel.appendLine(`[SSH] 启动shell失败: ${err.message}`);
                    conn.end();
                    reject(err);
                    return;
                }
                stream.on('close', () => {
                    outputChannel.appendLine(`[SSH] 命令执行完毕，连接关闭`);
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
                stream.write(`${command}\nexit\n`);
            });
        }).on('error', (err) => {
            outputChannel.appendLine(`[SSH] 连接错误: ${err.message}`);
            reject(err);
        }).connect({
            host: config.host,
            port: config.port,
            username: config.username,
            password: config.password,
            tryKeyboard: true
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
//# sourceMappingURL=ssh.js.map