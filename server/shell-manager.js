import pty from 'node-pty';
import { generateClaudeEnvVars } from './utils/claude-config.js';

/**
 * 持久Shell会话管理器
 * 维护服务端shell进程，支持客户端断开重连
 */
class ShellSessionManager {
    constructor() {
        this.sessions = new Map(); // sessionKey -> SessionData
        this.cleanupInterval = null;
        this.startCleanupTimer();
    }

    /**
     * 会话数据结构
     * @typedef {Object} SessionData
     * @property {Object} ptyProcess - node-pty进程实例
     * @property {Array} outputBuffer - 输出缓冲区（用于重连时回放）
     * @property {string} projectPath - 项目路径
     * @property {string} sessionId - Claude会话ID
     * @property {Date} createdAt - 创建时间
     * @property {Date} lastActiveAt - 最后活跃时间
     * @property {boolean} isConnected - 当前是否有WebSocket连接
     * @property {Object} currentWs - 当前的WebSocket连接
     * @property {number} cols - 终端列数
     * @property {number} rows - 终端行数
     */

    /**
     * 生成会话键 - 现在只基于项目路径
     */
    generateSessionKey(projectPath) {
        return `project-${projectPath.replace(/[/\\]/g, '_')}`;
    }

    /**
     * 创建或获取shell会话
     */
    async getOrCreateSession(projectPath, sessionId = null, cols = 80, rows = 24) {
        const sessionKey = this.generateSessionKey(projectPath);

        // 如果会话已存在，返回现有会话
        if (this.sessions.has(sessionKey)) {
            const session = this.sessions.get(sessionKey);
            session.lastActiveAt = new Date();

            // 调整终端大小
            if (session.ptyProcess && session.ptyProcess.resize) {
                session.ptyProcess.resize(cols, rows);
            }

            console.log(`🔄 Reusing existing shell session: ${sessionKey}`);
            return { session, isNew: false };
        }

        // 创建新的shell会话
        console.log(`🚀 Creating new shell session for project: ${projectPath}`);

        // 如果有sessionId就恢复，否则启动新的claude会话
        const startCommand = sessionId ?
            `claude --resume ${sessionId}` : 'claude';

        // 生成Claude配置的环境变量
        const claudeEnvVars = await generateClaudeEnvVars();
        console.log(`🔧 Shell session using Claude env vars:`, Object.keys(claudeEnvVars));

        const ptyProcess = pty.spawn('bash', ['-c', `cd "${projectPath}" && ${startCommand}`], {
            name: 'xterm-256color',
            cols: cols,
            rows: rows,
            env: {
                ...process.env,
                ...claudeEnvVars, // 添加Claude配置的环境变量
                TERM: 'xterm-256color',
                COLORTERM: 'truecolor',
                FORCE_COLOR: '3'
            }
        });

        const sessionData = {
            ptyProcess,
            outputBuffer: [],
            projectPath,
            sessionId,
            reconnectedSessionId: sessionId, // 保存重连时的sessionId，不会改变
            createdAt: new Date(),
            lastActiveAt: new Date(),
            isConnected: false,
            currentWs: null,
            cols,
            rows
        };

        // 监听进程输出并缓存
        ptyProcess.onData((data) => {
            // 保存到缓冲区（最多保留1000条）
            sessionData.outputBuffer.push({
                data,
                timestamp: Date.now()
            });

            if (sessionData.outputBuffer.length > 1000) {
                sessionData.outputBuffer = sessionData.outputBuffer.slice(-800); // 保留最新800条
            }

            // 如果有活跃连接，转发数据
            if (sessionData.isConnected && sessionData.currentWs) {
                this.sendToWebSocket(sessionData.currentWs, data);
            }
        });

        // 监听进程退出
        ptyProcess.onExit((exitCode) => {
            console.log(`💀 Shell session ${sessionKey} exited with code ${exitCode}`);
            this.sessions.delete(sessionKey);
        });

        this.sessions.set(sessionKey, sessionData);

        return { session: sessionData, isNew: true };
    }

    /**
     * 连接WebSocket到现有会话
     */
    attachWebSocket(projectPath, ws) {
        const sessionKey = this.generateSessionKey(projectPath);
        const session = this.sessions.get(sessionKey);

        if (!session) {
            console.warn(`⚠️ Cannot attach WebSocket, session not found: ${sessionKey}`);
            return false;
        }

        // 如果已有连接，断开旧连接
        if (session.isConnected && session.currentWs) {
            console.log(`🔄 Replacing existing WebSocket connection for ${sessionKey}`);
            session.currentWs.close();
        }

        // 连接新的WebSocket
        session.isConnected = true;
        session.currentWs = ws;
        session.lastActiveAt = new Date();

        console.log(`🔗 WebSocket attached to session: ${sessionKey}`);

        // 回放缓冲区中的最近输出（最多最近50条或30秒内的）
        this.replayRecentOutput(session, ws);

        return true;
    }

    /**
     * 断开WebSocket连接（但保持shell进程运行）
     */
    detachWebSocket(projectPath) {
        const sessionKey = this.generateSessionKey(projectPath);
        const session = this.sessions.get(sessionKey);

        if (session) {
            session.isConnected = false;
            session.currentWs = null;
            session.lastActiveAt = new Date();
            console.log(`🔌 WebSocket detached from session: ${sessionKey} (shell continues running)`);
            return true;
        }

        return false;
    }

    /**
     * 发送输入到shell会话
     */
    writeToSession(projectPath, data) {
        const sessionKey = this.generateSessionKey(projectPath);
        const session = this.sessions.get(sessionKey);

        if (session && session.ptyProcess) {
            session.ptyProcess.write(data);
            session.lastActiveAt = new Date();
            return true;
        }

        return false;
    }

    /**
     * 调整会话终端大小
     */
    resizeSession(projectPath, cols, rows) {
        const sessionKey = this.generateSessionKey(projectPath);
        const session = this.sessions.get(sessionKey);

        if (session && session.ptyProcess && session.ptyProcess.resize) {
            session.ptyProcess.resize(cols, rows);
            session.cols = cols;
            session.rows = rows;
            session.lastActiveAt = new Date();
            console.log(`📏 Resized session ${sessionKey} to ${cols}x${rows}`);
            return true;
        }

        return false;
    }

    /**
     * 终止shell会话
     */
    killSession(projectPath, force = false) {
        const sessionKey = this.generateSessionKey(projectPath);
        const session = this.sessions.get(sessionKey);

        if (!session) {
            console.log(`ℹ️ Session ${sessionKey} not found for termination`);
            return true;
        }

        console.log(`💀 Terminating session: ${sessionKey}`);

        if (session.ptyProcess) {
            if (force) {
                session.ptyProcess.kill('SIGKILL');
            } else {
                // 尝试优雅退出
                session.ptyProcess.write('exit\r');

                // 5秒后强制杀死
                setTimeout(() => {
                    if (this.sessions.has(sessionKey)) {
                        console.log(`💀 Force killing session: ${sessionKey}`);
                        session.ptyProcess.kill('SIGKILL');
                    }
                }, 5000);
            }
        }

        this.sessions.delete(sessionKey);
        return true;
    }

    /**
     * 获取会话状态信息
     */
    getSessionStatus(projectPath) {
        const sessionKey = this.generateSessionKey(projectPath);
        const session = this.sessions.get(sessionKey);

        if (!session) {
            return { exists: false, sessionKey };
        }

        return {
            exists: true,
            sessionKey,
            isConnected: session.isConnected,
            createdAt: session.createdAt,
            lastActiveAt: session.lastActiveAt,
            projectPath: session.projectPath,
            sessionId: session.sessionId,
            reconnectedSessionId: session.reconnectedSessionId, // 返回重连时的sessionId
            processId: session.ptyProcess.pid,
            bufferSize: session.outputBuffer.length,
            cols: session.cols,
            rows: session.rows
        };
    }

    /**
     * 获取所有活跃会话
     */
    getAllSessions() {
        const sessions = [];
        for (const [key, session] of this.sessions) {
            sessions.push({
                key,
                status: this.getSessionStatus(session.projectPath)
            });
        }
        return sessions;
    }

    /**
     * 回放所有缓存的输出到WebSocket (完整的1000条)
     */
    replayRecentOutput(session, ws) {
        if (!session.outputBuffer.length) {
            return;
        }

        console.log(`🔄 Replaying ${session.outputBuffer.length} buffered output entries`);

        // 发送分隔符
        this.sendToWebSocket(ws, `\r\n\x1b[2m--- Restoring previous output (${session.outputBuffer.length} entries) ---\x1b[0m\r\n`);

        // 回放所有缓存的输出
        for (const item of session.outputBuffer) {
            this.sendToWebSocket(ws, item.data);
        }

        // 发送分隔符
        this.sendToWebSocket(ws, '\r\n\x1b[2m--- End previous output ---\x1b[0m\r\n');
    }

    /**
     * 发送数据到WebSocket（处理URL检测）
     */
    sendToWebSocket(ws, data) {
        if (ws.readyState !== ws.OPEN) {
            return;
        }

        let outputData = data;

        // URL检测和处理
        const patterns = [
            /(?:xdg-open|open|start)\s+(https?:\/\/[^\s\x1b\x07]+)/g,
            /OPEN_URL:\s*(https?:\/\/[^\s\x1b\x07]+)/g,
            /Opening\s+(https?:\/\/[^\s\x1b\x07]+)/gi,
            /Visit:\s*(https?:\/\/[^\s\x1b\x07]+)/gi,
            /View at:\s*(https?:\/\/[^\s\x1b\x07]+)/gi,
            /Browse to:\s*(https?:\/\/[^\s\x1b\x07]+)/gi
        ];

        patterns.forEach(pattern => {
            let match;
            while ((match = pattern.exec(data)) !== null) {
                const url = match[1];
                console.log('🔗 Detected URL for opening:', url);

                // 发送URL打开消息
                ws.send(JSON.stringify({
                    type: 'url_open',
                    url: url
                }));

                // 替换OPEN_URL模式
                if (pattern.source.includes('OPEN_URL')) {
                    outputData = outputData.replace(match[0], `🌐 Opening in browser: ${url}`);
                }
            }
        });

        // 发送常规输出
        ws.send(JSON.stringify({
            type: 'output',
            data: outputData
        }));
    }

    /**
     * 启动定期清理任务
     */
    startCleanupTimer() {
        // 每10分钟检查一次不活跃的会话
        this.cleanupInterval = setInterval(() => {
            this.cleanupInactiveSessions();
        }, 10 * 60 * 1000); // 10分钟
    }

    /**
     * 清理不活跃的会话（2小时无活动）
     */
    cleanupInactiveSessions() {
        const now = new Date();
        const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

        const sessionsToDelete = [];

        for (const [key, session] of this.sessions) {
            if (session.lastActiveAt < twoHoursAgo && !session.isConnected) {
                sessionsToDelete.push(key);
            }
        }

        if (sessionsToDelete.length > 0) {
            console.log(`🧹 Cleaning up ${sessionsToDelete.length} inactive sessions`);

            for (const key of sessionsToDelete) {
                const session = this.sessions.get(key);
                if (session && session.ptyProcess) {
                    session.ptyProcess.kill();
                }
                this.sessions.delete(key);
            }
        }
    }

    /**
     * 清理所有会话
     */
    cleanup() {
        console.log('🧹 Cleaning up all shell sessions...');

        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }

        for (const [key, session] of this.sessions) {
            if (session.ptyProcess) {
                session.ptyProcess.kill();
            }
        }

        this.sessions.clear();
    }
}

// 创建全局实例
const shellManager = new ShellSessionManager();

// 进程退出时清理
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down shell manager...');
    shellManager.cleanup();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Terminating shell manager...');
    shellManager.cleanup();
    process.exit(0);
});

export default shellManager;