import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

class TmuxSessionManager {
    constructor() {
        this.sessionPrefix = 'claudeui';
    }

    /**
     * 生成会话名称，基于sessionId
     * @param {string} sessionId 会话ID
     * @returns {string} tmux会话名称
     */
    generateSessionName(sessionId) {
        return `${this.sessionPrefix}-${sessionId}`;
    }

    /**
     * 检查tmux会话是否存在
     * @param {string} sessionName tmux会话名称
     * @returns {Promise<boolean>} 会话是否存在
     */
    async sessionExists(sessionName) {
        try {
            await execAsync(`tmux has-session -t "${sessionName}"`);
            return true;
        } catch (error) {
            // tmux服务器没有运行或会话不存在都返回false
            return false;
        }
    }

    /**
     * 检查sessionId是否有对应的tmux会话
     * @param {string} sessionId 会话ID
     * @returns {Promise<boolean>} 是否存在tmux会话
     */
    async hasSessionTmux(sessionId) {
        const sessionName = this.generateSessionName(sessionId);
        return await this.sessionExists(sessionName);
    }

    /**
     * 获取sessionId对应的tmux会话状态
     * @param {string} sessionId 会话ID
     * @returns {Promise<Object>} 会话状态信息
     */
    async getSessionStatus(sessionId) {
        const sessionName = this.generateSessionName(sessionId);
        const exists = await this.sessionExists(sessionName);

        if (!exists) {
            return { exists: false, sessionName, attached: false };
        }

        try {
            const { stdout } = await execAsync(`tmux list-sessions -F "#{session_name}:#{session_attached}" | grep "^${sessionName}:"`);
            const attached = parseInt(stdout.split(':')[1]) > 0;
            return { exists: true, sessionName, attached };
        } catch (error) {
            // tmux服务器没有运行或会话不存在
            return { exists: false, sessionName, attached: false };
        }
    }

    /**
     * 为sessionId创建tmux会话
     * @param {string} sessionId 会话ID
     * @param {string} projectPath 项目路径
     * @param {number} cols 终端列数
     * @param {number} rows 终端行数
     * @returns {Promise<Object>} 会话信息
     */
    async createSessionForId(sessionId, projectPath, cols = 80, rows = 24) {
        const tmuxSessionName = this.generateSessionName(sessionId);

        // 检查会话是否已存在
        if (await this.sessionExists(tmuxSessionName)) {
            console.log(`📋 Tmux session already exists for sessionId: ${sessionId}`);
            return { tmuxSessionName, sessionId, exists: true };
        }

        try {
            // 准备启动命令，直接恢复指定的sessionId
            const startCommand = `cd "${projectPath}" && claude --resume ${sessionId}`;

            // 创建tmux会话，并设置初始尺寸
            const createCommand = `tmux new-session -d -s "${tmuxSessionName}" -c "${projectPath}" -x ${cols} -y ${rows} '${startCommand}'`;

            await execAsync(createCommand);

            console.log(`✅ Created tmux session for sessionId: ${sessionId} in ${projectPath} (${cols}x${rows})`, createCommand);

            return {
                tmuxSessionName,
                sessionId,
                projectPath,
                created: new Date(),
                exists: true
            };
        } catch (error) {
            console.error('❌ Failed to create tmux session:', error);
            throw new Error(`Failed to create tmux session: ${error.message}`);
        }
    }

    /**
     * 为sessionId附加到现有tmux会话
     * @param {string} sessionId 会话ID
     * @returns {Promise<string>} tmux会话名称
     */
    async attachToSessionId(sessionId) {
        const tmuxSessionName = this.generateSessionName(sessionId);
        if (!await this.sessionExists(tmuxSessionName)) {
            throw new Error(`Tmux session for sessionId '${sessionId}' does not exist`);
        }

        console.log(`🔗 Attaching to tmux session for sessionId: ${sessionId}`);
        return tmuxSessionName;
    }

    /**
     * 从sessionId对应的tmux会话分离
     * @param {string} sessionId 会话ID
     */
    async detachFromSessionId(sessionId) {
        const tmuxSessionName = this.generateSessionName(sessionId);
        try {
            // 分离所有客户端，但保持会话运行
            await execAsync(`tmux detach-client -s "${tmuxSessionName}"`);
            console.log(`🔌 Detached from tmux session for sessionId: ${sessionId}`);
        } catch (error) {
            // 如果没有客户端附加，命令会失败，但这不是错误
            console.log(`ℹ️ No clients to detach from sessionId: ${sessionId}`);
        }
    }

    /**
     * 安全终止sessionId对应的tmux会话
     * @param {string} sessionId 会话ID
     * @param {boolean} force 是否强制终止
     */
    async killSessionId(sessionId, force = false) {
        const tmuxSessionName = this.generateSessionName(sessionId);

        try {
            // 检查会话是否存在
            if (!await this.sessionExists(tmuxSessionName)) {
                console.log(`ℹ️ Tmux session for sessionId ${sessionId} does not exist`);
                return;
            }

            if (!force) {
                // 先尝试优雅地发送退出命令
                try {
                    console.log(`🔄 Attempting graceful shutdown of sessionId: ${sessionId}`);
                    await this.sendCommandToSessionId(sessionId, 'exit');

                    // 等待2秒让进程自然退出
                    await new Promise(resolve => setTimeout(resolve, 2000));

                    // 检查会话是否已经自然结束
                    if (!await this.sessionExists(tmuxSessionName)) {
                        console.log(`✅ SessionId ${sessionId} exited gracefully`);
                        return;
                    }
                } catch (gracefulError) {
                    console.log(`⚠️ Graceful shutdown failed, proceeding with force kill: ${gracefulError.message}`);
                }
            }

            // 强制终止会话
            console.log(`💀 Force killing tmux session for sessionId: ${sessionId}`);
            await execAsync(`tmux kill-session -t "${tmuxSessionName}"`);
            console.log(`✅ Killed tmux session for sessionId: ${sessionId}`);
        } catch (error) {
            console.error(`❌ Failed to kill tmux session for sessionId ${sessionId}:`, error.message);
        }
    }

    /**
     * 清理所有ClaudeUI相关的tmux会话
     */
    async cleanupAllSessions() {
        try {
            const { stdout } = await execAsync('tmux list-sessions -F "#{session_name}"');
            const sessions = stdout.trim().split('\n')
                .filter(line => line.startsWith(this.sessionPrefix))
                .filter(line => line.trim() !== ''); // 过滤空行

            if (sessions.length === 0) {
                console.log('🧹 No tmux sessions to cleanup');
                return;
            }

            for (const sessionName of sessions) {
                try {
                    await execAsync(`tmux kill-session -t "${sessionName}"`);
                } catch (killError) {
                    console.warn(`⚠️ Failed to kill session ${sessionName}:`, killError.message);
                }
            }
            console.log(`🧹 Cleaned up ${sessions.length} tmux sessions`);
        } catch (error) {
            // tmux服务器没有运行或没有会话是正常情况
            const errorMsg = error.message || '';
            const stderrMsg = error.stderr || '';
            
            if (errorMsg.includes('no server running') || 
                stderrMsg.includes('no server running') ||
                errorMsg.includes('no sessions') || 
                error.code === 1) {
                console.log('🧹 No tmux server running or no sessions to cleanup');
                return;
            }
            console.error('❌ Failed to cleanup sessions:', error.message);
        }
    }

    /**
     * 创建到sessionId对应tmux会话的pty连接
     * @param {string} sessionId 会话ID
     * @param {number} cols 终端列数
     * @param {number} rows 终端行数
     * @returns {Promise<Object>} pty进程对象
     */
    async createPtyConnectionForSessionId(sessionId, cols = 80, rows = 24) {
        const tmuxSessionName = this.generateSessionName(sessionId);
        const pty = await import('node-pty');

        // 设置tmux会话的终端大小 - 更强制的方式
        try {
            // 先设置窗口大小
            await execAsync(`tmux resize-window -t "${tmuxSessionName}" -x ${cols} -y ${rows}`);
            console.log(`📏 Resized tmux window to ${cols}x${rows} for sessionId: ${sessionId}`);

            // 然后设置pane大小（确保内容区域也正确）
            await execAsync(`tmux resize-pane -t "${tmuxSessionName}:0" -x ${cols} -y ${rows}`);
        } catch (error) {
            console.warn(`⚠️ Failed to resize tmux session ${tmuxSessionName}:`, error.message);
        }

        // 创建附加到tmux会话的pty进程
        const tmuxProcess = pty.spawn('tmux', ['attach-session', '-t', tmuxSessionName], {
            name: 'xterm-256color',
            cols: cols,
            rows: rows,
            env: {
                ...process.env,
                TERM: 'xterm-256color',
                COLORTERM: 'truecolor',
                FORCE_COLOR: '3'
            }
        });

        console.log(`🔗 Created PTY connection to tmux session for sessionId: ${sessionId} (${cols}x${rows})`);
        return tmuxProcess;
    }

    /**
     * 发送命令到sessionId对应的tmux会话
     * @param {string} sessionId 会话ID
     * @param {string} command 要执行的命令
     */
    async sendCommandToSessionId(sessionId, command) {
        const tmuxSessionName = this.generateSessionName(sessionId);
        try {
            // 使用tmux send-keys发送命令
            await execAsync(`tmux send-keys -t "${tmuxSessionName}" "${command}" Enter`);
            console.log(`📤 Sent command to sessionId ${sessionId}: ${command}`);
        } catch (error) {
            console.error(`❌ Failed to send command to sessionId ${sessionId}:`, error.message);
            throw error;
        }
    }
}

// 创建全局实例
const tmuxManager = new TmuxSessionManager();

// 进程退出时不清理tmux会话，保持持久化
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down, tmux sessions will continue running...');
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n🛑 Terminating, tmux sessions will continue running...');
    process.exit(0);
});

export default tmuxManager;