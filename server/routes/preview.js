import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import os from 'os';
import { authenticateToken } from '../middleware/auth.js';
import { extractProjectDirectory } from '../projects.js';

const router = express.Router();

// 存储运行中的开发服务器进程
const runningServers = new Map();

// 读取项目的 .claudeui.json 配置文件
async function readProjectConfig(projectPath) {
  try {
    const configPath = path.join(projectPath, '.claudeui.json');
    const configData = await fs.readFile(configPath, 'utf8');
    return JSON.parse(configData);
  } catch (error) {
    // 配置文件不存在时返回默认配置
    return null;
  }
}

// 保存项目配置文件
async function saveProjectConfig(projectPath, config) {
  const configPath = path.join(projectPath, '.claudeui.json');
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
}

// 检测项目类型并生成推荐配置
async function detectProjectType(projectPath) {
  try {
    const packageJsonPath = path.join(projectPath, 'package.json');
    const packageData = await fs.readFile(packageJsonPath, 'utf8');
    const packageJson = JSON.parse(packageData);
    
    const scripts = packageJson.scripts || {};
    const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
    
    // 根据依赖检测框架类型
    if (dependencies['next']) {
      return { port: 3000, command: scripts.dev || 'npm run dev', type: 'Next.js', directory: '' };
    } else if (dependencies['react-scripts']) {
      return { port: 3000, command: scripts.start || 'npm start', type: 'Create React App', directory: '' };
    } else if (dependencies['vue'] && dependencies['@vue/cli-service']) {
      return { port: 8080, command: scripts.serve || 'npm run serve', type: 'Vue CLI', directory: '' };
    } else if (dependencies['vite']) {
      return { port: 5173, command: scripts.dev || 'npm run dev', type: 'Vite', directory: '' };
    } else if (dependencies['@angular/cli']) {
      return { port: 4200, command: scripts.start || 'npm start', type: 'Angular', directory: '' };
    } else if (dependencies['nuxt']) {
      return { port: 3000, command: scripts.dev || 'npm run dev', type: 'Nuxt.js', directory: '' };
    } else if (scripts.dev) {
      return { port: 3000, command: scripts.dev, type: 'Custom', directory: '' };
    } else if (scripts.start) {
      return { port: 3000, command: scripts.start, type: 'Custom', directory: '' };
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

// 获取项目预览配置
router.get('/project/:name/preview/config', authenticateToken, async (req, res) => {
  try {
    const { name: projectName } = req.params;
    const projectPath = await extractProjectDirectory(projectName);
    
    // 检查项目目录是否存在
    try {
      await fs.access(projectPath);
    } catch (error) {
      return res.status(404).json({ error: 'Project directory not found', path: projectPath });
    }
    
    let config = await readProjectConfig(projectPath);
    
    // 如果配置不存在，尝试自动检测
    if (!config) {
      const detected = await detectProjectType(projectPath);
      config = detected ? { dev: detected } : null;
    }
    
    res.json({ 
      success: true, 
      config,
      projectPath,
      hasConfig: config !== null
    });
  } catch (error) {
    console.error('Error reading project config:', error);
    res.status(500).json({ error: 'Failed to read project config', details: error.message });
  }
});

// 保存项目预览配置
router.put('/project/:name/preview/config', authenticateToken, async (req, res) => {
  try {
    const { name: projectName } = req.params;
    const { config } = req.body;
    
    if (!config || !config.dev) {
      return res.status(400).json({ error: 'Invalid config format' });
    }
    
    const projectPath = await extractProjectDirectory(projectName);
    
    // 验证配置
    const { port, command } = config.dev;
    if (!port || !command) {
      return res.status(400).json({ error: 'Port and command are required' });
    }
    
    if (port < 1024 || port > 65535) {
      return res.status(400).json({ error: 'Port must be between 1024 and 65535' });
    }
    
    await saveProjectConfig(projectPath, config);
    
    res.json({ success: true, config });
  } catch (error) {
    console.error('Error saving project config:', error);
    res.status(500).json({ error: 'Failed to save project config', details: error.message });
  }
});

// 获取开发服务器状态
router.get('/project/:name/preview/status', authenticateToken, async (req, res) => {
  try {
    const { name: projectName } = req.params;
    const serverInfo = runningServers.get(projectName);
    
    if (!serverInfo) {
      return res.json({ running: false, status: 'stopped' });
    }
    
    // 检查进程是否还在运行
    const isRunning = serverInfo.process && !serverInfo.process.killed;
    
    if (!isRunning) {
      runningServers.delete(projectName);
      return res.json({ running: false, status: 'stopped' });
    }
    
    res.json({ 
      running: true, 
      status: 'running',
      port: serverInfo.port,
      pid: serverInfo.process.pid,
      startTime: serverInfo.startTime
    });
  } catch (error) {
    console.error('Error getting server status:', error);
    res.status(500).json({ error: 'Failed to get server status', details: error.message });
  }
});

// 启动开发服务器
router.post('/project/:name/preview/start', authenticateToken, async (req, res) => {
  try {
    const { name: projectName } = req.params;
    
    // 检查是否已经在运行
    if (runningServers.has(projectName)) {
      const serverInfo = runningServers.get(projectName);
      if (serverInfo.process && !serverInfo.process.killed) {
        return res.status(400).json({ error: 'Server is already running' });
      } else {
        runningServers.delete(projectName);
      }
    }
    
    const projectPath = await extractProjectDirectory(projectName);
    const config = await readProjectConfig(projectPath);
    
    if (!config || !config.dev) {
      return res.status(400).json({ error: 'No development server configuration found' });
    }
    
    const { port, command, directory = '' } = config.dev;
    const [cmd, ...args] = command.split(' ');
    
    // 确定工作目录
    const workingDirectory = directory 
      ? path.join(projectPath, directory.replace(/^\/+/, '')) 
      : projectPath;
    
    console.log(`🚀 Starting development server for project: ${projectName}`);
    console.log(`   Command: ${command}`);
    console.log(`   Port: ${port}`);
    console.log(`   Project Directory: ${projectPath}`);
    console.log(`   Working Directory: ${workingDirectory}`);
    
    // 检查工作目录是否存在
    try {
      await fs.access(workingDirectory);
    } catch (error) {
      return res.status(400).json({ 
        error: `Working directory does not exist: ${directory}`,
        details: `Path: ${workingDirectory}` 
      });
    }
    
    // 启动开发服务器
    const serverProcess = spawn(cmd, args, {
      cwd: workingDirectory,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PORT: port.toString() }
    });
    
    // 存储服务器信息
    const serverInfo = {
      process: serverProcess,
      port,
      startTime: new Date(),
      output: []
    };
    
    runningServers.set(projectName, serverInfo);
    console.log(`✅ Development server process created for ${projectName} (PID: ${serverProcess.pid})`);
    
    // 监听进程输出
    serverProcess.stdout.on('data', (data) => {
      const output = data.toString();
      serverInfo.output.push({ type: 'stdout', data: output, timestamp: new Date() });
      // 只保留最近的100条日志
      if (serverInfo.output.length > 100) {
        serverInfo.output.shift();
      }
    });
    
    serverProcess.stderr.on('data', (data) => {
      const output = data.toString();
      serverInfo.output.push({ type: 'stderr', data: output, timestamp: new Date() });
      if (serverInfo.output.length > 100) {
        serverInfo.output.shift();
      }
    });
    
    serverProcess.on('close', (code) => {
      console.log(`🔴 Development server for ${projectName} exited with code ${code}`);
      runningServers.delete(projectName);
    });
    
    serverProcess.on('error', (error) => {
      console.error(`Failed to start development server for ${projectName}:`, error);
      runningServers.delete(projectName);
    });
    
    res.json({ 
      success: true, 
      message: 'Development server starting',
      port,
      pid: serverProcess.pid
    });
    
  } catch (error) {
    console.error('Error starting development server:', error);
    res.status(500).json({ error: 'Failed to start development server', details: error.message });
  }
});

// 停止开发服务器
router.post('/project/:name/preview/stop', authenticateToken, async (req, res) => {
  try {
    const { name: projectName } = req.params;
    const serverInfo = runningServers.get(projectName);
    
    if (!serverInfo || !serverInfo.process) {
      return res.status(400).json({ error: 'No running server found' });
    }
    
    console.log(`🛑 Stopping development server for project: ${projectName}`);
    
    // 优雅地停止进程
    serverInfo.process.kill('SIGTERM');
    
    // 如果5秒后还没停止，强制停止
    setTimeout(() => {
      if (runningServers.has(projectName)) {
        const info = runningServers.get(projectName);
        if (info.process && !info.process.killed) {
          console.log(`⚡ Force killing development server for project: ${projectName}`);
          info.process.kill('SIGKILL');
        }
        runningServers.delete(projectName);
        console.log(`✅ Development server for ${projectName} force stopped`);
      }
    }, 5000);
    
    res.json({ success: true, message: 'Development server stopping' });
    
  } catch (error) {
    console.error('Error stopping development server:', error);
    res.status(500).json({ error: 'Failed to stop development server', details: error.message });
  }
});

// 获取服务器日志
router.get('/project/:name/preview/logs', authenticateToken, async (req, res) => {
  try {
    const { name: projectName } = req.params;
    const serverInfo = runningServers.get(projectName);
    
    if (!serverInfo) {
      return res.json({ logs: [] });
    }
    
    res.json({ 
      logs: serverInfo.output || [],
      running: serverInfo.process && !serverInfo.process.killed
    });
    
  } catch (error) {
    console.error('Error getting server logs:', error);
    res.status(500).json({ error: 'Failed to get server logs', details: error.message });
  }
});

// 获取全局预览配置
router.get('/global-config', authenticateToken, async (req, res) => {
  try {
    const globalConfigPath = path.join(os.homedir(), '.claude', 'preview-config.json');
    let globalConfig = { 
      host: 'localhost', 
      openInNewTab: true 
    };
    
    try {
      const configData = await fs.readFile(globalConfigPath, 'utf8');
      globalConfig = { ...globalConfig, ...JSON.parse(configData) };
    } catch (error) {
      // 配置文件不存在时返回默认配置
    }
    
    res.json({ success: true, config: globalConfig });
  } catch (error) {
    console.error('Error reading global preview config:', error);
    res.status(500).json({ error: 'Failed to read global preview config', details: error.message });
  }
});

// 保存全局预览配置
router.put('/global-config', authenticateToken, async (req, res) => {
  try {
    const { config } = req.body;
    
    if (!config) {
      return res.status(400).json({ error: 'Config is required' });
    }
    
    // 验证配置
    const { host = 'localhost', openInNewTab = true } = config;
    
    const validatedConfig = {
      host: host.trim() || 'localhost',
      openInNewTab: Boolean(openInNewTab)
    };
    
    // 确保 .claude 目录存在
    const claudeDir = path.join(os.homedir(), '.claude');
    try {
      await fs.access(claudeDir);
    } catch {
      await fs.mkdir(claudeDir, { recursive: true });
    }
    
    const globalConfigPath = path.join(claudeDir, 'preview-config.json');
    await fs.writeFile(globalConfigPath, JSON.stringify(validatedConfig, null, 2), 'utf8');
    
    res.json({ success: true, config: validatedConfig });
  } catch (error) {
    console.error('Error saving global preview config:', error);
    res.status(500).json({ error: 'Failed to save global preview config', details: error.message });
  }
});

export default router;