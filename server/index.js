// Load environment variables from .env file
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

try {
    const envPath = path.join(__dirname, '../.env');
    const envFile = fs.readFileSync(envPath, 'utf8');
    envFile.split('\n').forEach(line => {
        const trimmedLine = line.trim();
        if (trimmedLine && !trimmedLine.startsWith('#')) {
            const [key, ...valueParts] = trimmedLine.split('=');
            if (key && valueParts.length > 0 && !process.env[key]) {
                process.env[key] = valueParts.join('=').trim();
            }
        }
    });
} catch (e) {
    console.log('No .env file found or error reading it:', e.message);
}

console.log('PORT from env:', process.env.PORT);

import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'http';
import cors from 'cors';
import { promises as fsPromises } from 'fs';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import pty from 'node-pty';
import mime from 'mime-types';

const execAsync = promisify(exec);

import { getProjects, getSessions, getSessionMessages, renameProject, deleteSession, deleteOldSessions, deleteProject, addProjectManually, extractProjectDirectory, clearProjectDirectoryCache } from './projects.js';
import { spawnClaude, abortClaudeSession, getSessionStates, getSessionState } from './claude-cli.js';
import gitRoutes from './routes/git.js';
import authRoutes from './routes/auth.js';
import mcpRoutes from './routes/mcp.js';
import previewRoutes from './routes/preview.js';
import { initializeDatabase } from './database/db.js';
import { validateApiKey, authenticateToken, authenticateWebSocket } from './middleware/auth.js';
import shellManager from './shell-manager.js';

// File system watcher for projects folder
let projectsWatcher = null;
const connectedClients = new Set();

// Setup file system watcher for Claude projects folder using chokidar
async function setupProjectsWatcher() {
    const chokidar = (await import('chokidar')).default;
    const claudeProjectsPath = path.join(process.env.HOME, '.claude', 'projects');

    if (projectsWatcher) {
        projectsWatcher.close();
    }

    try {
        // Initialize chokidar watcher with optimized settings
        projectsWatcher = chokidar.watch(claudeProjectsPath, {
            ignored: [
                '**/node_modules/**',
                '**/.git/**',
                '**/dist/**',
                '**/build/**',
                '**/*.tmp',
                '**/*.swp',
                '**/.DS_Store'
            ],
            persistent: true,
            ignoreInitial: true, // Don't fire events for existing files on startup
            followSymlinks: false,
            depth: 10, // Reasonable depth limit
            awaitWriteFinish: {
                stabilityThreshold: 100, // Wait 100ms for file to stabilize
                pollInterval: 50
            }
        });

        // Debounce function to prevent excessive notifications
        let debounceTimer;
        const debouncedUpdate = async (eventType, filePath) => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(async () => {
                try {
                    //console.log(`--SetupProjectsWatcher File ${eventType}:`, filePath);

                    // Clear project directory cache when files change
                    clearProjectDirectoryCache();

                    // Get updated projects list
                    //filePath /home/test/.claude/projects/-home-test-codes-single-book/38045670-f26a-4c33-876e-6e06c2dab350.jsonl
                    //todo 这里还可以优化,只更新文件目录project的内容
                    const updatedProjects = await getProjects();

                    // Notify all connected clients about the project changes
                    const updateMessage = JSON.stringify({
                        type: 'projects_updated',
                        projects: updatedProjects,
                        timestamp: new Date().toISOString(),
                        changeType: eventType,
                        changedFile: path.relative(claudeProjectsPath, filePath)
                    });

                    connectedClients.forEach(client => {
                        if (client.readyState === client.OPEN) {
                            client.send(updateMessage);
                        }
                    });

                } catch (error) {
                    console.error('❌ Error handling project changes:', error);
                }
            }, 300); // 300ms debounce (slightly faster than before)
        };

        // Set up event listeners
        projectsWatcher
            .on('add', (filePath) => debouncedUpdate('add', filePath))
            .on('change', (filePath) => debouncedUpdate('change', filePath))
            .on('unlink', (filePath) => debouncedUpdate('unlink', filePath))
            .on('addDir', (dirPath) => debouncedUpdate('addDir', dirPath))
            .on('unlinkDir', (dirPath) => debouncedUpdate('unlinkDir', dirPath))
            .on('error', (error) => {
                console.error('❌ Chokidar watcher error:', error);
            })
            .on('ready', () => {
            });

    } catch (error) {
        console.error('❌ Failed to setup projects watcher:', error);
    }
}


const app = express();
const server = http.createServer(app);

// Single WebSocket server that handles both paths
const wss = new WebSocketServer({
    server,
    verifyClient: (info) => {
        console.log('WebSocket connection attempt to:', info.req.url);

        // Extract token from query parameters or headers
        const url = new URL(info.req.url, 'http://localhost');
        const token = url.searchParams.get('token') ||
            info.req.headers.authorization?.split(' ')[1];

        // Verify token
        const user = authenticateWebSocket(token);
        if (!user) {
            console.log('❌ WebSocket authentication failed');
            return false;
        }

        // Store user info in the request for later use
        info.req.user = user;
        console.log('✅ WebSocket authenticated for user:', user.username);
        return true;
    }
});

app.use(cors());
app.use(express.json());

// Optional API key validation (if configured)
app.use('/api', validateApiKey);

// Authentication routes (public)
app.use('/api/auth', authRoutes);

// Git API Routes (protected)
app.use('/api/git', authenticateToken, gitRoutes);

// MCP API Routes (protected)
app.use('/api/mcp', authenticateToken, mcpRoutes);


// Preview API Routes (protected)
app.use('/api', authenticateToken, previewRoutes);


// Static files served after API routes
app.use(express.static(path.join(__dirname, '../dist')));

// API Routes (protected)
app.get('/api/config', authenticateToken, (req, res) => {
    const host = req.headers.host || `${req.hostname}:${PORT}`;
    const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'wss' : 'ws';

    console.log('Config API called - Returning host:', host, 'Protocol:', protocol);

    res.json({
        serverPort: PORT,
        wsUrl: `${protocol}://${host}`
    });
});

// Claude configuration API endpoints
app.get('/api/claude/config', authenticateToken, async (req, res) => {
    try {
        const homeDir = os.homedir();
        const webuiConfigPath = path.join(homeDir, '.claude', 'claude-webui.json');
        const settingsPath = path.join(homeDir, '.claude', 'settings.json');

        let config = {};

        // 读取环境变量
        if (process.env.ANTHROPIC_BASE_URL) config.baseUrl = process.env.ANTHROPIC_BASE_URL;
        if (process.env.ANTHROPIC_AUTH_TOKEN) config.authToken = process.env.ANTHROPIC_AUTH_TOKEN;
        if (process.env.ANTHROPIC_MODEL) config.model = process.env.ANTHROPIC_MODEL;
        if (process.env.ANTHROPIC_SMALL_FAST_MODEL) config.smallModel = process.env.ANTHROPIC_SMALL_FAST_MODEL;
        if (process.env.HTTP_PROXY) config.httpProxy = process.env.HTTP_PROXY;
        if (process.env.HTTPS_PROXY) config.httpsProxy = process.env.HTTPS_PROXY;

        // 读取settings.json中的模型配置
        try {
            const settingsData = await fsPromises.readFile(settingsPath, 'utf8');
            const settings = JSON.parse(settingsData);
            if (settings.env) {
                if (settings.env.ANTHROPIC_MODEL) config.model = settings.env.ANTHROPIC_MODEL;
                if (settings.env.ANTHROPIC_SMALL_FAST_MODEL) config.smallModel = settings.env.ANTHROPIC_SMALL_FAST_MODEL;
            }
        } catch (error) {
            console.log('settings.json not found or invalid:', error.message);
        }

        // 读取webui配置文件
        try {
            const webuiData = await fsPromises.readFile(webuiConfigPath, 'utf8');
            const webuiConfig = JSON.parse(webuiData);
            config = { ...config, ...webuiConfig };
        } catch (error) {
            if (!error.message.includes('ENOENT')) {
                console.log('claude-webui.json not found or invalid:', error.message);
            }
        }

        res.json(config);
    } catch (error) {
        console.error('Error reading Claude config:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/claude/config', authenticateToken, async (req, res) => {
    try {
        const { provider, model, smallModel, baseUrl, authToken, httpProxy, httpsProxy } = req.body;
        const homeDir = os.homedir();
        const claudeDir = path.join(homeDir, '.claude');
        const webuiConfigPath = path.join(claudeDir, 'claude-webui.json');

        // 确保.claude目录存在
        await fsPromises.mkdir(claudeDir, { recursive: true });

        // 保存到claude-webui.json，包括模型配置
        const webuiConfig = {
            provider,
            model,
            smallModel,
            baseUrl,
            authToken,
            httpProxy,
            httpsProxy,
            lastUpdated: new Date().toISOString()
        };

        // 过滤空值
        Object.keys(webuiConfig).forEach(key => {
            if (webuiConfig[key] === '' || webuiConfig[key] === null || webuiConfig[key] === undefined) {
                delete webuiConfig[key];
            }
        });

        await fsPromises.writeFile(webuiConfigPath, JSON.stringify(webuiConfig, null, 2), 'utf8');
        console.log('Saved claude-webui.json:', webuiConfig);

        res.json({ success: true, message: 'Configuration saved successfully' });
    } catch (error) {
        console.error('Error saving Claude config:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/projects', authenticateToken, async (req, res) => {
    try {
        const projects = await getProjects();
        res.json(projects);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/projects/:projectName/sessions', authenticateToken, async (req, res) => {
    try {
        const { limit = 5, offset = 0 } = req.query;
        const result = await getSessions(req.params.projectName, parseInt(limit), parseInt(offset));
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get messages for a specific session
app.get('/api/projects/:projectName/sessions/:sessionId/messages', authenticateToken, async (req, res) => {
    try {
        const { projectName, sessionId } = req.params;
        const { limit, offset } = req.query;

        // Parse limit and offset if provided
        const parsedLimit = limit ? parseInt(limit, 10) : null;
        const parsedOffset = offset ? parseInt(offset, 10) : 0;

        const result = await getSessionMessages(projectName, sessionId, parsedLimit, parsedOffset);

        // Handle both old and new response formats
        if (Array.isArray(result)) {
            // Backward compatibility: no pagination parameters were provided
            res.json({ messages: result });
        } else {
            // New format with pagination info
            res.json(result);
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get all active session states
app.get('/api/session-states', authenticateToken, (req, res) => {
    try {
        const states = getSessionStates();
        res.json({ sessionStates: states });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get specific session state
app.get('/api/session-states/:sessionId', authenticateToken, (req, res) => {
    try {
        const { sessionId } = req.params;
        const state = getSessionState(sessionId);
        if (state) {
            res.json({ sessionId, ...state });
        } else {
            res.status(404).json({ error: 'Session not found' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Rename project endpoint
app.put('/api/projects/:projectName/rename', authenticateToken, async (req, res) => {
    try {
        const { displayName } = req.body;
        await renameProject(req.params.projectName, displayName);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete session endpoint
app.delete('/api/projects/:projectName/sessions/:sessionId', authenticateToken, async (req, res) => {
    try {
        const { projectName, sessionId } = req.params;
        await deleteSession(projectName, sessionId);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Cleanup old sessions endpoint
app.post('/api/cleanup-old-sessions', authenticateToken, async (req, res) => {
    try {
        const { projectName } = req.body; // Get project name from request body
        const result = await deleteOldSessions(projectName);
        res.json({
            success: true,
            ...result
        });
    } catch (error) {
        console.error('Cleanup error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Delete project endpoint (only if empty)
app.delete('/api/projects/:projectName', authenticateToken, async (req, res) => {
    try {
        const { projectName } = req.params;
        await deleteProject(projectName);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create project endpoint
app.post('/api/projects/create', authenticateToken, async (req, res) => {
    try {
        const { path: projectPath } = req.body;

        if (!projectPath || !projectPath.trim()) {
            return res.status(400).json({ error: 'Project path is required' });
        }

        const project = await addProjectManually(projectPath.trim());
        res.json({ success: true, project });
    } catch (error) {
        console.error('Error creating project:', error);
        res.status(500).json({ error: error.message });
    }
});

// Read file content endpoint
app.get('/api/projects/:projectName/file', authenticateToken, async (req, res) => {
    try {
        const { projectName } = req.params;
        const { filePath } = req.query;

        console.log('📄 File read request:', projectName, filePath);

        // Using fsPromises from import

        // Security check - ensure the path is safe and absolute
        if (!filePath || !path.isAbsolute(filePath)) {
            return res.status(400).json({ error: 'Invalid file path' });
        }

        const content = await fsPromises.readFile(filePath, 'utf8');
        res.json({ content, path: filePath });
    } catch (error) {
        console.error('Error reading file:', error);
        if (error.code === 'ENOENT') {
            res.status(404).json({ error: 'File not found' });
        } else if (error.code === 'EACCES') {
            res.status(403).json({ error: 'Permission denied' });
        } else {
            res.status(500).json({ error: error.message });
        }
    }
});

// Serve binary file content endpoint (for images, etc.)
app.get('/api/projects/:projectName/files/content', authenticateToken, async (req, res) => {
    try {
        const { projectName } = req.params;
        const { path: filePath } = req.query;

        console.log('🖼️ Binary file serve request:', projectName, filePath);

        // Using fs from import
        // Using mime from import

        // Security check - ensure the path is safe and absolute
        if (!filePath || !path.isAbsolute(filePath)) {
            return res.status(400).json({ error: 'Invalid file path' });
        }

        // Check if file exists
        try {
            await fsPromises.access(filePath);
        } catch (error) {
            return res.status(404).json({ error: 'File not found' });
        }

        // Get file extension and set appropriate content type
        const mimeType = mime.lookup(filePath) || 'application/octet-stream';
        res.setHeader('Content-Type', mimeType);

        // Stream the file
        const fileStream = fs.createReadStream(filePath);
        fileStream.pipe(res);

        fileStream.on('error', (error) => {
            console.error('Error streaming file:', error);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Error reading file' });
            }
        });

    } catch (error) {
        console.error('Error serving binary file:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        }
    }
});

// Save file content endpoint
app.put('/api/projects/:projectName/file', authenticateToken, async (req, res) => {
    try {
        const { projectName } = req.params;
        const { filePath, content } = req.body;

        console.log('💾 File save request:', projectName, filePath);

        // Using fsPromises from import

        // Security check - ensure the path is safe and absolute
        if (!filePath || !path.isAbsolute(filePath)) {
            return res.status(400).json({ error: 'Invalid file path' });
        }

        if (content === undefined) {
            return res.status(400).json({ error: 'Content is required' });
        }

        // Create backup of original file
        try {
            const backupPath = filePath + '.backup.' + Date.now();
            await fsPromises.copyFile(filePath, backupPath);
            console.log('📋 Created backup:', backupPath);
        } catch (backupError) {
            console.warn('Could not create backup:', backupError.message);
        }

        // Write the new content
        await fsPromises.writeFile(filePath, content, 'utf8');

        res.json({
            success: true,
            path: filePath,
            message: 'File saved successfully'
        });
    } catch (error) {
        console.error('Error saving file:', error);
        if (error.code === 'ENOENT') {
            res.status(404).json({ error: 'File or directory not found' });
        } else if (error.code === 'EACCES') {
            res.status(403).json({ error: 'Permission denied' });
        } else {
            res.status(500).json({ error: error.message });
        }
    }
});

app.get('/api/projects/:projectName/files', authenticateToken, async (req, res) => {
    try {

        // Using fsPromises from import

        // Use extractProjectDirectory to get the actual project path
        let actualPath;
        try {
            actualPath = await extractProjectDirectory(req.params.projectName);
        } catch (error) {
            console.error('Error extracting project directory:', error);
            // Fallback to simple dash replacement
            actualPath = req.params.projectName.replace(/-/g, '/');
        }

        // Check if path exists
        try {
            await fsPromises.access(actualPath);
        } catch (e) {
            return res.status(404).json({ error: `Project path not found: ${actualPath}` });
        }

        const files = await getFileTree(actualPath, 3, 0, true);
        const hiddenFiles = files.filter(f => f.name.startsWith('.'));
        res.json(files);
    } catch (error) {
        console.error('❌ File tree error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// WebSocket connection handler that routes based on URL path
wss.on('connection', (ws, request) => {
    const url = request.url;
    console.log('🔗 Client connected to:', url);

    // Parse URL to get pathname without query parameters
    const urlObj = new URL(url, 'http://localhost');
    const pathname = urlObj.pathname;

    if (pathname === '/shell') {
        handleShellConnection(ws);
    } else if (pathname === '/plain-shell') {
        handlePlainShellConnection(ws);
    } else if (pathname === '/ws') {
        handleChatConnection(ws);
    } else {
        console.log('❌ Unknown WebSocket path:', pathname);
        ws.close();
    }
});

// Handle chat WebSocket connections
function handleChatConnection(ws) {
    console.log('💬 Chat WebSocket connected');

    // Add to connected clients for project updates
    connectedClients.add(ws);

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'claude-command') {
                console.log('💬 User message:', data.command || '[Continue/Resume]');
                console.log('📁 Project:', data.options?.projectPath || 'Unknown');
                console.log('🔄 Session:', data.options?.sessionId ? 'Resume' : 'New');
                await spawnClaude(data.command, data.options, ws);

                // 发送会话完成消息 (不再需要，claude-cli.js中已经处理)
                // ws.send(JSON.stringify({
                //     type: 'session-complete',
                //     sessionId: data.options?.sessionId
                // }));
            } else if (data.type === 'abort-session') {
                console.log('🛑 Abort session request:', data.sessionId);
                const provider = data.provider || 'claude';
                const success = abortClaudeSession(data.sessionId);
                ws.send(JSON.stringify({
                    type: 'session-aborted',
                    sessionId: data.sessionId,
                    provider,
                    success
                }));
            }
        } catch (error) {
            console.error('❌ Chat WebSocket error:', error.message);
            ws.send(JSON.stringify({
                type: 'error',
                error: error.message
            }));
        }
    });

    ws.on('close', () => {
        console.log('🔌 Chat client disconnected');
        // Remove from connected clients
        connectedClients.delete(ws);
    });
}

// Handle shell WebSocket connections
function handleShellConnection(ws) {
    console.log('🐚 Shell client connected');
    let currentSessionId = null;
    let currentProjectPath = null;

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'init') {
                const projectPath = data.projectPath || process.cwd();
                const sessionId = data.sessionId;
                const hasSession = data.hasSession;
                const cols = data.cols || 80;
                const rows = data.rows || 24;

                currentSessionId = sessionId;
                currentProjectPath = projectPath;

                console.log('🚀 Initializing persistent shell session');
                console.log('📂 Project:', projectPath);
                console.log('📋 SessionId:', sessionId);

                try {
                    // 获取或创建持久会话
                    const { session, isNew, startCommand } = await shellManager.getOrCreateSession(
                        projectPath, sessionId, cols, rows
                    );

                    // 连接WebSocket到会话
                    shellManager.attachWebSocket(projectPath, ws);

                    // 发送欢迎消息
                    let welcomeMsg;
                    if (isNew) {
                        welcomeMsg = `\x1b[36m🚀 Started new persistent Claude session\x1b[0m\r\n`;
                        if (startCommand) {
                            welcomeMsg += `\x1b[33m📋 Command: ${startCommand}\x1b[0m\r\n`;
                        }
                    } else {
                        welcomeMsg = `\x1b[36m🔄 Reconnected to existing Claude session\x1b[0m\r\n`;
                    }

                    ws.send(JSON.stringify({
                        type: 'output',
                        data: welcomeMsg
                    }));

                    console.log(`🟢 ${isNew ? 'Created' : 'Reconnected to'} session for ${sessionId || 'project'}`);

                } catch (shellError) {
                    console.error('❌ Error managing shell session:', shellError);
                    ws.send(JSON.stringify({
                        type: 'output',
                        data: `\r\n\x1b[31mError: ${shellError.message}\x1b[0m\r\n`
                    }));
                }

            } else if (data.type === 'input') {
                // 发送输入到持久会话
                if (currentProjectPath) {
                    const success = shellManager.writeToSession(currentProjectPath, data.data);
                    if (!success) {
                        console.warn('⚠️ Failed to write to session');
                    }
                } else {
                    console.warn('⚠️ No active session for input');
                }

            } else if (data.type === 'resize') {
                // 调整持久会话终端大小
                const cols = data.cols || 80;
                const rows = data.rows || 24;

                if (currentProjectPath) {
                    shellManager.resizeSession(currentProjectPath, cols, rows);
                }
            }
        } catch (error) {
            console.error('❌ Shell WebSocket error:', error.message);
            if (ws.readyState === ws.OPEN) {
                ws.send(JSON.stringify({
                    type: 'output',
                    data: `\r\n\x1b[31mError: ${error.message}\x1b[0m\r\n`
                }));
            }
        }
    });

    ws.on('close', () => {
        console.log('🔌 Shell client disconnected');

        // 断开WebSocket但保持shell进程运行
        if (currentProjectPath) {
            shellManager.detachWebSocket(currentProjectPath);
        }
    });

    ws.on('error', (error) => {
        console.error('❌ Shell WebSocket error:', error);

        // 发生错误时也要断开连接
        if (currentProjectPath) {
            shellManager.detachWebSocket(currentProjectPath);
        }
    });
}

// Handle plain shell WebSocket connections (no Claude CLI, no server caching)
function handlePlainShellConnection(ws) {
    console.log('🐚 Plain Shell client connected');
    let ptyProcess = null;
    let currentProjectPath = null;

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'init') {
                const projectPath = data.projectPath || process.cwd();
                const cols = data.cols || 80;
                const rows = data.rows || 24;

                currentProjectPath = projectPath;

                console.log('🚀 Initializing plain shell session');
                console.log('📂 Project:', projectPath);

                try {
                    // Create a new pty process for each connection (no caching)
                    const shell = process.env.SHELL || '/bin/bash';
                    
                    ptyProcess = pty.spawn(shell, ['-i'], {
                        name: 'xterm-color',
                        cols: cols,
                        rows: rows,
                        cwd: projectPath,
                        env: {
                            ...process.env,
                            TERM: 'xterm-256color',
                            COLORTERM: 'truecolor',
                            // Force interactive shell
                            PS1: process.env.PS1 || '\\[\\033[01;32m\\]\\u@\\h\\[\\033[00m\\]:\\[\\033[01;34m\\]\\w\\[\\033[00m\\]\\$ '
                        }
                    });

                    // Handle output from pty
                    ptyProcess.onData((data) => {
                        if (ws.readyState === ws.OPEN) {
                            ws.send(JSON.stringify({
                                type: 'output',
                                data: data
                            }));
                        }
                    });

                    // Handle pty exit
                    ptyProcess.onExit(({ exitCode, signal }) => {
                        console.log('🔚 Plain shell process exited:', { exitCode, signal });
                        if (ws.readyState === ws.OPEN) {
                            ws.send(JSON.stringify({
                                type: 'output',
                                data: `\r\n\x1b[33mShell session ended (exit code: ${exitCode})\x1b[0m\r\n`
                            }));
                            ws.close();
                        }
                    });

                    // Send welcome message
                    const welcomeMsg = `\x1b[32m🐚 Plain Shell started in ${projectPath}\x1b[0m\r\n`;
                    ws.send(JSON.stringify({
                        type: 'output',
                        data: welcomeMsg
                    }));

                    // Send an initial empty command to ensure prompt is displayed
                    setTimeout(() => {
                        if (ptyProcess && ws.readyState === ws.OPEN) {
                            // Send empty line to trigger prompt display
                            ptyProcess.write('\r');
                        }
                    }, 200);

                    console.log('🟢 Plain shell session created');

                } catch (shellError) {
                    console.error('❌ Error creating plain shell session:', shellError);
                    ws.send(JSON.stringify({
                        type: 'output',
                        data: `\r\n\x1b[31mError: ${shellError.message}\x1b[0m\r\n`
                    }));
                }

            } else if (data.type === 'input') {
                // Send input to pty process
                if (ptyProcess) {
                    ptyProcess.write(data.data);
                } else {
                    console.warn('⚠️ No active pty process for input');
                }

            } else if (data.type === 'resize') {
                // Resize pty process
                const cols = data.cols || 80;
                const rows = data.rows || 24;

                if (ptyProcess) {
                    try {
                        ptyProcess.resize(cols, rows);
                        console.log(`📐 Plain shell resized to ${cols}x${rows}`);
                    } catch (resizeError) {
                        console.warn('⚠️ Failed to resize pty:', resizeError.message);
                    }
                }
            }
        } catch (error) {
            console.error('❌ Plain Shell WebSocket error:', error.message);
            if (ws.readyState === ws.OPEN) {
                ws.send(JSON.stringify({
                    type: 'output',
                    data: `\r\n\x1b[31mError: ${error.message}\x1b[0m\r\n`
                }));
            }
        }
    });

    ws.on('close', () => {
        console.log('🔌 Plain Shell client disconnected');
        
        // Kill the pty process when client disconnects
        if (ptyProcess) {
            try {
                ptyProcess.kill();
                console.log('🗑️ Plain shell process terminated');
            } catch (error) {
                console.warn('⚠️ Error killing pty process:', error.message);
            }
            ptyProcess = null;
        }
    });

    ws.on('error', (error) => {
        console.error('❌ Plain Shell WebSocket error:', error);
        
        // Kill the pty process on error
        if (ptyProcess) {
            try {
                ptyProcess.kill();
                console.log('🗑️ Plain shell process terminated due to error');
            } catch (killError) {
                console.warn('⚠️ Error killing pty process:', killError.message);
            }
            ptyProcess = null;
        }
    });
}

// Image upload endpoint
app.post('/api/projects/:projectName/upload-images', authenticateToken, async (req, res) => {
    try {
        const multer = (await import('multer')).default;
        const path = (await import('path')).default;
        const fs = (await import('fs')).promises;
        const os = (await import('os')).default;

        // Configure multer for image uploads
        const storage = multer.diskStorage({
            destination: async (req, file, cb) => {
                const uploadDir = path.join(os.tmpdir(), 'claude-ui-uploads', String(req.user.id));
                await fs.mkdir(uploadDir, { recursive: true });
                cb(null, uploadDir);
            },
            filename: (req, file, cb) => {
                const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
                const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
                cb(null, uniqueSuffix + '-' + sanitizedName);
            }
        });

        const fileFilter = (req, file, cb) => {
            const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
            if (allowedMimes.includes(file.mimetype)) {
                cb(null, true);
            } else {
                cb(new Error('Invalid file type. Only JPEG, PNG, GIF, WebP, and SVG are allowed.'));
            }
        };

        const upload = multer({
            storage,
            fileFilter,
            limits: {
                fileSize: 5 * 1024 * 1024, // 5MB
                files: 5
            }
        });

        // Handle multipart form data
        upload.array('images', 5)(req, res, async (err) => {
            if (err) {
                return res.status(400).json({ error: err.message });
            }

            if (!req.files || req.files.length === 0) {
                return res.status(400).json({ error: 'No image files provided' });
            }

            try {
                // Process uploaded images
                const processedImages = await Promise.all(
                    req.files.map(async (file) => {
                        // Read file and convert to base64
                        const buffer = await fs.readFile(file.path);
                        const base64 = buffer.toString('base64');
                        const mimeType = file.mimetype;

                        // Clean up temp file immediately
                        await fs.unlink(file.path);

                        return {
                            name: file.originalname,
                            data: `data:${mimeType};base64,${base64}`,
                            size: file.size,
                            mimeType: mimeType
                        };
                    })
                );

                res.json({ images: processedImages });
            } catch (error) {
                console.error('Error processing images:', error);
                // Clean up any remaining files
                await Promise.all(req.files.map(f => fs.unlink(f.path).catch(() => { })));
                res.status(500).json({ error: 'Failed to process images' });
            }
        });
    } catch (error) {
        console.error('Error in image upload endpoint:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Shell会话管理API

// 获取项目shell状态
app.get('/api/projects/:projectName/shell-status', authenticateToken, async (req, res) => {
    try {
        const { projectName } = req.params;
        const projectPath = await extractProjectDirectory(projectName);

        const status = shellManager.getSessionStatus(projectPath);
        res.json(status);
    } catch (error) {
        console.error('Error checking shell session status:', error);
        res.status(500).json({ error: error.message });
    }
});

// 终止项目Shell会话
app.delete('/api/projects/:projectName/shell', authenticateToken, async (req, res) => {
    try {
        const { projectName } = req.params;
        const { force = false } = req.query;
        const projectPath = await extractProjectDirectory(projectName);

        const success = shellManager.killSession(projectPath, force === 'true');
        res.json({ success });
    } catch (error) {
        console.error('Error terminating shell session:', error);
        res.status(500).json({ error: error.message });
    }
});

// 获取所有活跃Shell会话
app.get('/api/shell-sessions', authenticateToken, async (req, res) => {
    try {
        const sessions = shellManager.getAllSessions();
        res.json({ sessions });
    } catch (error) {
        console.error('Error getting shell sessions:', error);
        res.status(500).json({ error: error.message });
    }
});

// Preview endpoints - simplified for direct URL access
app.get('/api/preview/:projectName/url', authenticateToken, async (req, res) => {
    try {
        const { projectName } = req.params;
        const projectPath = await extractProjectDirectory(projectName);

        // 读取项目配置获取端口
        const configPath = path.join(projectPath, '.claudeui.json');
        let config;
        try {
            const configData = await fsPromises.readFile(configPath, 'utf8');
            config = JSON.parse(configData);
        } catch (error) {
            return res.status(404).json({ error: 'No development server configuration found' });
        }

        if (!config || !config.dev || !config.dev.port) {
            return res.status(404).json({ error: 'No development server configuration found' });
        }

        // 获取全局预览配置
        const globalConfigPath = path.join(os.homedir(), '.claude', 'preview-config.json');
        let globalConfig = { host: 'localhost', openInNewTab: true };
        try {
            const globalConfigData = await fsPromises.readFile(globalConfigPath, 'utf8');
            globalConfig = { ...globalConfig, ...JSON.parse(globalConfigData) };
        } catch (error) {
            // 使用默认配置
        }

        const previewUrl = `http://${globalConfig.host}:${config.dev.port}`;

        res.json({
            success: true,
            url: previewUrl,
            port: config.dev.port,
            host: globalConfig.host,
            openInNewTab: globalConfig.openInNewTab
        });

    } catch (error) {
        console.error('Preview URL error:', error);
        res.status(500).json({ error: 'Failed to get preview URL', details: error.message });
    }
});

// Serve React app for all other routes
app.get('*', (req, res) => {
    if (process.env.NODE_ENV === 'production') {
        res.sendFile(path.join(__dirname, '../dist/index.html'));
    } else {
        // In development, redirect to Vite dev server
        res.redirect(`http://localhost:${process.env.VITE_PORT || 3001}`);
    }
});

// Helper function to convert permissions to rwx format
function permToRwx(perm) {
    const r = perm & 4 ? 'r' : '-';
    const w = perm & 2 ? 'w' : '-';
    const x = perm & 1 ? 'x' : '-';
    return r + w + x;
}

async function getFileTree(dirPath, maxDepth = 3, currentDepth = 0, showHidden = true) {
    // Using fsPromises from import
    const items = [];

    try {
        const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
            // Debug: log all entries including hidden files


            // Skip only heavy build directories
            if (entry.name === 'node_modules' ||
                entry.name === 'dist' ||
                entry.name === 'build') continue;

            const itemPath = path.join(dirPath, entry.name);
            const item = {
                name: entry.name,
                path: itemPath,
                type: entry.isDirectory() ? 'directory' : 'file'
            };

            // Get file stats for additional metadata
            try {
                const stats = await fsPromises.stat(itemPath);
                item.size = stats.size;
                item.modified = stats.mtime.toISOString();

                // Convert permissions to rwx format
                const mode = stats.mode;
                const ownerPerm = (mode >> 6) & 7;
                const groupPerm = (mode >> 3) & 7;
                const otherPerm = mode & 7;
                item.permissions = ((mode >> 6) & 7).toString() + ((mode >> 3) & 7).toString() + (mode & 7).toString();
                item.permissionsRwx = permToRwx(ownerPerm) + permToRwx(groupPerm) + permToRwx(otherPerm);
            } catch (statError) {
                // If stat fails, provide default values
                item.size = 0;
                item.modified = null;
                item.permissions = '000';
                item.permissionsRwx = '---------';
            }

            if (entry.isDirectory() && currentDepth < maxDepth) {
                // Recursively get subdirectories but limit depth
                try {
                    // Check if we can access the directory before trying to read it
                    await fsPromises.access(item.path, fs.constants.R_OK);
                    item.children = await getFileTree(item.path, maxDepth, currentDepth + 1, showHidden);
                } catch (e) {
                    // Silently skip directories we can't access (permission denied, etc.)
                    item.children = [];
                }
            }

            items.push(item);
        }
    } catch (error) {
        // Only log non-permission errors to avoid spam
        if (error.code !== 'EACCES' && error.code !== 'EPERM') {
            console.error('Error reading directory:', error);
        }
    }

    return items.sort((a, b) => {
        if (a.type !== b.type) {
            return a.type === 'directory' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
    });
}

const PORT = process.env.PORT || 3001;

// Initialize database and start server
async function startServer() {
    try {
        // Initialize authentication database
        await initializeDatabase();
        console.log('✅ Database initialization skipped (testing)');

        server.listen(PORT, '0.0.0.0', async () => {
            console.log(`Claude Code UI server running on http://0.0.0.0:${PORT}`);

            // Start watching the projects folder for changes
            await setupProjectsWatcher();
        });
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

startServer();
