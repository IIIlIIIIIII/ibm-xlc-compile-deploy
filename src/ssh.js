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
Object.defineProperty(exports, "__esModule", { value: true });
exports.runRemoteCommand = runRemoteCommand;
const ssh2_1 = require("ssh2");
const vscode = __importStar(require("vscode"));
/**
 * 通过SSH执行远程命令（伪终端模式），支持交互式输出到VSCode的输出通道，
 * 并且命令执行完成后弹出一个带滚动条的Webview面板显示完整返回结果
 * @param config SSH连接配置
 * @param command 远程执行的命令
 * @param title 用于输出通道标题和Webview面板标题
 */
async function runRemoteCommand(config, command, title) {
    return new Promise((resolve, reject) => {
        const conn = new ssh2_1.Client();
        const outputChannel = vscode.window.createOutputChannel(title);
        outputChannel.show(true);
        let fullOutput = ''; // 用于缓存所有输出文本
        conn.on('ready', () => {
            outputChannel.appendLine(`SSH连接成功，开始执行命令: ${command}`);
            conn.shell((err, stream) => {
                if (err) {
                    outputChannel.appendLine(`开启终端失败: ${err.message}`);
                    conn.end();
                    reject(err);
                    return;
                }
                stream.on('close', () => {
                    outputChannel.appendLine('命令执行结束，终端关闭');
                    conn.end();
                    // 创建Webview面板显示完整输出
                    const panel = vscode.window.createWebviewPanel('sshCommandOutput', `${title} - 命令输出`, vscode.ViewColumn.One, { enableScripts: true });
                    // 用 <pre> 保持格式，并加滚动条
                    panel.webview.html = `
            <!DOCTYPE html>
            <html lang="zh-cn">
            <head>
              <meta charset="UTF-8" />
              <title>${title} - 输出结果</title>
              <style>
                body {
                  font-family: Consolas, 'Courier New', monospace;
                  margin: 0; padding: 10px;
                  background-color: #1e1e1e;
                  color: #d4d4d4;
                }
                pre {
                  white-space: pre-wrap;
                  word-break: break-word;
                  max-height: 90vh;
                  overflow: auto;
                  padding: 10px;
                  border: 1px solid #333;
                  background-color: #252526;
                }
              </style>
            </head>
            <body>
              <h3>命令: <code>${command}</code></h3>
              <pre>${escapeHtml(fullOutput)}</pre>
            </body>
            </html>
          `;
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
            outputChannel.appendLine(`SSH连接错误: ${err.message}`);
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
// 简单转义HTML，防止输出里有特殊字符破坏页面结构
function escapeHtml(unsafe) {
    return unsafe.replace(/[&<>"']/g, function (m) {
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