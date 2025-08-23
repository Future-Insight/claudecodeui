import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

/**
 * 从配置文件生成Claude环境变量
 * 按优先级读取环境变量、settings.json、claude-webui.json
 */
export async function generateClaudeEnvVars() {
  try {
    const homeDir = os.homedir();
    const webuiConfigPath = path.join(homeDir, '.claude', 'claude-webui.json');
    const settingsPath = path.join(homeDir, '.claude', 'settings.json');
    
    let envVars = {};
    
    // 1. First, read from environment variables (highest priority)
    if (process.env.ANTHROPIC_BASE_URL) envVars.ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL;
    if (process.env.ANTHROPIC_AUTH_TOKEN) envVars.ANTHROPIC_AUTH_TOKEN = process.env.ANTHROPIC_AUTH_TOKEN;
    if (process.env.ANTHROPIC_MODEL) envVars.ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL;
    if (process.env.ANTHROPIC_SMALL_FAST_MODEL) envVars.ANTHROPIC_SMALL_FAST_MODEL = process.env.ANTHROPIC_SMALL_FAST_MODEL;
    if (process.env.HTTP_PROXY) envVars.HTTP_PROXY = process.env.HTTP_PROXY;
    if (process.env.HTTPS_PROXY) envVars.HTTPS_PROXY = process.env.HTTPS_PROXY;
    
    // 2. Read from ~/.claude/settings.json (medium priority)
    try {
      const settingsData = await fs.readFile(settingsPath, 'utf8');
      const settings = JSON.parse(settingsData);
      if (settings.env) {
        if (settings.env.ANTHROPIC_MODEL && !envVars.ANTHROPIC_MODEL) {
          envVars.ANTHROPIC_MODEL = settings.env.ANTHROPIC_MODEL;
        }
        if (settings.env.ANTHROPIC_SMALL_FAST_MODEL && !envVars.ANTHROPIC_SMALL_FAST_MODEL) {
          envVars.ANTHROPIC_SMALL_FAST_MODEL = settings.env.ANTHROPIC_SMALL_FAST_MODEL;
        }
      }
    } catch (error) {
      // settings.json not found or invalid, continue
    }
    
    // 3. Read from ~/.claude/claude-webui.json (lowest priority)
    try {
      const webuiData = await fs.readFile(webuiConfigPath, 'utf8');
      const webuiConfig = JSON.parse(webuiData);
      
      if (webuiConfig.baseUrl && !envVars.ANTHROPIC_BASE_URL) {
        envVars.ANTHROPIC_BASE_URL = webuiConfig.baseUrl;
      }
      if (webuiConfig.authToken && !envVars.ANTHROPIC_AUTH_TOKEN) {
        envVars.ANTHROPIC_AUTH_TOKEN = webuiConfig.authToken;
      }
      if (webuiConfig.model && !envVars.ANTHROPIC_MODEL) {
        envVars.ANTHROPIC_MODEL = webuiConfig.model;
      }
      if (webuiConfig.smallModel && !envVars.ANTHROPIC_SMALL_FAST_MODEL) {
        envVars.ANTHROPIC_SMALL_FAST_MODEL = webuiConfig.smallModel;
      }
      if (webuiConfig.httpProxy && !envVars.HTTP_PROXY) {
        envVars.HTTP_PROXY = webuiConfig.httpProxy;
      }
      if (webuiConfig.httpsProxy && !envVars.HTTPS_PROXY) {
        envVars.HTTPS_PROXY = webuiConfig.httpsProxy;
      }
    } catch (error) {
      // claude-webui.json not found or invalid, continue
    }
    
    // Filter out empty values
    Object.keys(envVars).forEach(key => {
      if (!envVars[key] || envVars[key] === '') {
        delete envVars[key];
      }
    });
    
    if (Object.keys(envVars).length > 0) {
      console.log('🔧 Generated Claude env vars:', Object.keys(envVars));
    }
    
    return envVars;
  } catch (error) {
    console.error('Error generating Claude env vars:', error);
    return {};
  }
}