/**
 * API配置管理工具
 * 从环境变量和配置文件中读取API类型和相关配置
 */

// 支持的API提供商配置
export const API_PROVIDERS = {
  claude: {
    name: 'Claude',
    icon: '/icons/claude-ai-icon.svg',
    models: ['claude-3-5-sonnet-20241022', 'claude-3-haiku-20240307'],
    docs: 'https://docs.anthropic.com/claude/docs',
    description: 'Anthropic官方Claude API',
    defaultBaseUrl: 'https://api.anthropic.com'
  },
  gpt: {
    name: 'GPT',
    icon: '/icons/openai-icon.svg',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
    docs: 'https://platform.openai.com/docs',
    description: 'OpenAI GPT系列模型',
    defaultBaseUrl: 'https://api.openai.com'
  },
  deepseek: {
    name: 'DeepSeek',
    icon: '/icons/deepseek-icon.svg',
    models: ['deepseek-chat', 'deepseek-coder'],
    docs: 'https://platform.deepseek.com/api-docs',
    description: 'DeepSeek AI模型平台',
    defaultBaseUrl: 'https://api.deepseek.com'
  },
  qwen: {
    name: 'Qwen',
    icon: '/icons/qwen-icon.svg',
    models: ['qwen-max', 'qwen-plus', 'qwen-turbo'],
    docs: 'https://help.aliyun.com/zh/dashscope/',
    description: '阿里云通义千问大模型',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com'
  },
  other: {
    name: '其它',
    icon: '/icons/other-icon.svg',
    models: [],
    docs: '#',
    description: '其他AI模型提供商',
    defaultBaseUrl: ''
  }
};

// 默认配置
const DEFAULT_CONFIG = {
  provider: 'claude',
  model: 'claude-3-5-sonnet-20241022',
  smallModel: 'claude-3-haiku-20240307',
  baseUrl: null,
  authToken: null,
  httpProxy: null,
  httpsProxy: null
};

/**
 * 从模型名称推断API提供商
 */
function inferProviderFromModel(model) {
  if (!model) return 'claude';

  const modelLower = model.toLowerCase();

  if (modelLower.includes('claude')) return 'claude';
  if (modelLower.includes('gpt') || modelLower.includes('chatgpt')) return 'gpt';
  if (modelLower.includes('deepseek')) return 'deepseek';
  if (modelLower.includes('qwen')) return 'qwen';

  // 对于不匹配的模型，返回"其它"
  if (modelLower.includes('gemini') ||
    modelLower.includes('llama') ||
    modelLower.includes('mistral') ||
    modelLower.includes('yi') ||
    modelLower.includes('glm')) {
    return 'other';
  }

  // 默认返回claude
  return 'claude';
}

/**
 * 从BaseURL推断API提供商
 */
function inferProviderFromBaseUrl(baseUrl) {
  if (!baseUrl) return null;

  const urlLower = baseUrl.toLowerCase();

  if (urlLower.includes('anthropic')) return 'claude';
  if (urlLower.includes('openai')) return 'gpt';
  if (urlLower.includes('deepseek')) return 'deepseek';
  if (urlLower.includes('qwen') || urlLower.includes('dashscope')) return 'qwen';

  // 其他服务商归类为"其它"
  if (urlLower.includes('googleapis') ||
    urlLower.includes('bigmodel') ||
    urlLower.includes('zhipuai') ||
    urlLower.includes('huggingface') ||
    urlLower.includes('ollama')) {
    return 'other';
  }

  return null;
}

/**
 * 获取API配置
 */
export async function getApiConfig() {
  try {
    // 从后端获取Claude配置（包括环境变量、settings.json、claude-webui.json）
    const token = localStorage.getItem('auth-token');
    const response = await fetch('/api/claude/config', {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    });

    let config = { ...DEFAULT_CONFIG };

    if (response.ok) {
      try {
        const serverConfig = await response.json();
        config = { ...config, ...serverConfig };
      } catch (error) {
        console.log('Error parsing server config, using defaults');
      }
    } else {
      console.log('Failed to fetch server config, using defaults');
    }

    // 从配置中推断提供商
    let inferredProvider = config.provider;

    // 如果没有明确指定provider，尝试从模型名称和BaseURL推断
    if (!config.provider || config.provider === 'claude') {
      const modelProvider = inferProviderFromModel(config.model);
      const baseUrlProvider = inferProviderFromBaseUrl(config.baseUrl);

      // 优先使用从BaseURL推断的提供商，其次是模型名称
      inferredProvider = baseUrlProvider || modelProvider || 'claude';
    }

    return {
      provider: inferredProvider,
      model: config.model || '',
      smallModel: config.smallModel || '',
      baseUrl: config.baseUrl || '',
      authToken: config.authToken || '',
      httpProxy: config.httpProxy || '',
      httpsProxy: config.httpsProxy || '',
      providerInfo: API_PROVIDERS[inferredProvider] || API_PROVIDERS.claude
    };

  } catch (error) {
    console.error('Error getting API config:', error);

    // 发生错误时返回默认配置
    return {
      ...DEFAULT_CONFIG,
      providerInfo: API_PROVIDERS.claude
    };
  }
}

/**
 * 保存API配置到后端文件系统
 */
export async function saveApiConfig(config) {
  try {
    const configToSave = {
      provider: config.provider,
      model: config.model,
      smallModel: config.smallModel,
      baseUrl: config.baseUrl,
      authToken: config.authToken,
      httpProxy: config.httpProxy,
      httpsProxy: config.httpsProxy
    };

    // 保存到后端文件系统
    const token = localStorage.getItem('auth-token');
    const response = await fetch('/api/claude/config', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      body: JSON.stringify(configToSave)
    });

    if (response.ok) {
      const result = await response.json();
      console.log('Configuration saved to backend:', result.message);
      return true;
    } else {
      console.error('Failed to save configuration to backend');
      return false;
    }
  } catch (error) {
    console.error('Error saving API config:', error);
    return false;
  }
}

/**
 * 获取当前配置的提供商信息
 */
export async function getCurrentProvider() {
  const config = await getApiConfig();
  return {
    name: config.providerInfo.name,
    icon: config.providerInfo.icon,
    provider: config.provider
  };
}


// React Hook需要在React组件中单独定义，这里移除避免import问题