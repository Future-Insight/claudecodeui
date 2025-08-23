import { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { X, Plus, Settings, Shield, AlertTriangle, Moon, Sun, Server, Edit3, Trash2, Globe, Terminal, Zap, FolderOpen, Bot, ExternalLink } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { API_PROVIDERS, getApiConfig, saveApiConfig } from '../utils/apiConfig';

function ToolsSettings({ isOpen, onClose, projects = [] }) {
  const { isDarkMode, toggleDarkMode } = useTheme();
  const [allowedTools, setAllowedTools] = useState([]);
  const [disallowedTools, setDisallowedTools] = useState([]);
  const [newAllowedTool, setNewAllowedTool] = useState('');
  const [newDisallowedTool, setNewDisallowedTool] = useState('');
  const [skipPermissions, setSkipPermissions] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);
  const [projectSortOrder, setProjectSortOrder] = useState('name');

  const [mcpServers, setMcpServers] = useState([]);
  const [showMcpForm, setShowMcpForm] = useState(false);
  const [editingMcpServer, setEditingMcpServer] = useState(null);
  const [mcpFormData, setMcpFormData] = useState({
    name: '',
    type: 'stdio',
    scope: 'user',
    projectPath: '', // For local scope
    config: {
      command: '',
      args: [],
      env: {},
      url: '',
      headers: {},
      timeout: 30000
    },
    jsonInput: '', // For JSON import
    importMode: 'form' // 'form' or 'json'
  });
  const [mcpLoading, setMcpLoading] = useState(false);
  const [mcpTestResults, setMcpTestResults] = useState({});
  const [mcpServerTools, setMcpServerTools] = useState({});
  const [mcpToolsLoading, setMcpToolsLoading] = useState({});
  const [activeTab, setActiveTab] = useState('tools');
  const [jsonValidationError, setJsonValidationError] = useState('');
  
  // API配置状态
  const [apiConfig, setApiConfig] = useState({
    provider: 'claude',
    model: '',
    smallModel: '',
    baseUrl: '',
    authToken: '',
    httpProxy: '',
    httpsProxy: ''
  });
  const [apiConfigLoading, setApiConfigLoading] = useState(true);
  // Common tool patterns for Claude
  const commonTools = [
    'Bash(git log:*)',
    'Bash(git diff:*)',
    'Bash(git status:*)',
    'Write',
    'Read',
    'Edit',
    'Glob',
    'Grep',
    'MultiEdit',
    'Task',
    'TodoWrite',
    'TodoRead',
    'WebFetch',
    'WebSearch'
  ];

  
  // MCP API functions
  const fetchMcpServers = async () => {
    try {
      const token = localStorage.getItem('auth-token');
      
      // Try to read directly from config files for complete details
      const configResponse = await fetch('/api/mcp/config/read', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (configResponse.ok) {
        const configData = await configResponse.json();
        if (configData.success && configData.servers) {
          setMcpServers(configData.servers);
          return;
        }
      }
      
      // Fallback to Claude CLI
      const cliResponse = await fetch('/api/mcp/cli/list', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (cliResponse.ok) {
        const cliData = await cliResponse.json();
        if (cliData.success && cliData.servers) {
          // Convert CLI format to our format
          const servers = cliData.servers.map(server => ({
            id: server.name,
            name: server.name,
            type: server.type,
            scope: 'user',
            config: {
              command: server.command || '',
              args: server.args || [],
              env: server.env || {},
              url: server.url || '',
              headers: server.headers || {},
              timeout: 30000
            },
            created: new Date().toISOString(),
            updated: new Date().toISOString()
          }));
          setMcpServers(servers);
          return;
        }
      }
      
      // Final fallback to direct config reading
      const response = await fetch('/api/mcp/servers?scope=user', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        setMcpServers(data.servers || []);
      } else {
        console.error('Failed to fetch MCP servers');
      }
    } catch (error) {
      console.error('Error fetching MCP servers:', error);
    }
  };

  const saveMcpServer = async (serverData) => {
    try {
      const token = localStorage.getItem('auth-token');
      
      if (editingMcpServer) {
        // For editing, remove old server and add new one
        await deleteMcpServer(editingMcpServer.id, 'user');
      }
      
      // Use Claude CLI to add the server
      const response = await fetch('/api/mcp/cli/add', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: serverData.name,
          type: serverData.type,
          scope: serverData.scope,
          projectPath: serverData.projectPath,
          command: serverData.config?.command,
          args: serverData.config?.args || [],
          url: serverData.config?.url,
          headers: serverData.config?.headers || {},
          env: serverData.config?.env || {}
        })
      });
      
      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          await fetchMcpServers(); // Refresh the list
          return true;
        } else {
          throw new Error(result.error || 'Failed to save server via Claude CLI');
        }
      } else {
        const error = await response.json();
        throw new Error(error.error || 'Failed to save server');
      }
    } catch (error) {
      console.error('Error saving MCP server:', error);
      throw error;
    }
  };

  const deleteMcpServer = async (serverId, scope = 'user') => {
    try {
      const token = localStorage.getItem('auth-token');
      
      // Use Claude CLI to remove the server with proper scope
      const response = await fetch(`/api/mcp/cli/remove/${serverId}?scope=${scope}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          await fetchMcpServers(); // Refresh the list
          return true;
        } else {
          throw new Error(result.error || 'Failed to delete server via Claude CLI');
        }
      } else {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete server');
      }
    } catch (error) {
      console.error('Error deleting MCP server:', error);
      throw error;
    }
  };

  const testMcpServer = async (serverId, scope = 'user') => {
    try {
      const token = localStorage.getItem('auth-token');
      const response = await fetch(`/api/mcp/servers/${serverId}/test?scope=${scope}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        return data.testResult;
      } else {
        const error = await response.json();
        throw new Error(error.error || 'Failed to test server');
      }
    } catch (error) {
      console.error('Error testing MCP server:', error);
      throw error;
    }
  };


  const discoverMcpTools = async (serverId, scope = 'user') => {
    try {
      const token = localStorage.getItem('auth-token');
      const response = await fetch(`/api/mcp/servers/${serverId}/tools?scope=${scope}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        return data.toolsResult;
      } else {
        const error = await response.json();
        throw new Error(error.error || 'Failed to discover tools');
      }
    } catch (error) {
      console.error('Error discovering MCP tools:', error);
      throw error;
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadSettings();
    }
  }, [isOpen]);

  const loadSettings = async () => {
    try {
      
      // Load Claude settings from localStorage
      const savedSettings = localStorage.getItem('claude-tools-settings');
      
      if (savedSettings) {
        const settings = JSON.parse(savedSettings);
        setAllowedTools(settings.allowedTools || []);
        setDisallowedTools(settings.disallowedTools || []);
        setSkipPermissions(settings.skipPermissions || false);
        setProjectSortOrder(settings.projectSortOrder || 'name');
      } else {
        // Set defaults
        setAllowedTools([]);
        setDisallowedTools([]);
        setSkipPermissions(false);
        setProjectSortOrder('name');
      }
      
      // Load API configuration
      try {
        setApiConfigLoading(true);
        const currentApiConfig = await getApiConfig();
        setApiConfig({
          provider: currentApiConfig.provider || 'claude',
          model: currentApiConfig.model || '',
          smallModel: currentApiConfig.smallModel || '',
          baseUrl: currentApiConfig.baseUrl || '',
          authToken: currentApiConfig.authToken || '',
          httpProxy: currentApiConfig.httpProxy || '',
          httpsProxy: currentApiConfig.httpsProxy || ''
        });
      } catch (error) {
        console.error('Error loading API config:', error);
        setApiConfig({
          provider: 'claude',
          model: '',
          smallModel: '',
          baseUrl: '',
          authToken: '',
          httpProxy: '',
          httpsProxy: ''
        });
      } finally {
        setApiConfigLoading(false);
      }
      
      // Load MCP servers from API
      await fetchMcpServers();
    } catch (error) {
      console.error('Error loading tool settings:', error);
      // Set defaults on error
      setAllowedTools([]);
      setDisallowedTools([]);
      setSkipPermissions(false);
      setProjectSortOrder('name');
    }
  };

  const saveSettings = async () => {
    setIsSaving(true);
    setSaveStatus(null);
    
    try {
      // Save Claude settings
      const claudeSettings = {
        allowedTools,
        disallowedTools,
        skipPermissions,
        projectSortOrder,
        lastUpdated: new Date().toISOString()
      };
      
      // Save to localStorage
      localStorage.setItem('claude-tools-settings', JSON.stringify(claudeSettings));
      
      // Save API configuration (now async)
      const apiConfigSuccess = await saveApiConfig(apiConfig);
      
      if (apiConfigSuccess) {
        // 触发配置变更事件，通知其他组件更新
        window.dispatchEvent(new CustomEvent('apiConfigChanged'));
      }
      
      setSaveStatus('success');
      
      setTimeout(() => {
        onClose();
      }, 1000);
    } catch (error) {
      console.error('Error saving tool settings:', error);
      setSaveStatus('error');
    } finally {
      setIsSaving(false);
    }
  };

  const addAllowedTool = (tool) => {
    if (tool && !allowedTools.includes(tool)) {
      setAllowedTools([...allowedTools, tool]);
      setNewAllowedTool('');
    }
  };

  const removeAllowedTool = (tool) => {
    setAllowedTools(allowedTools.filter(t => t !== tool));
  };

  const addDisallowedTool = (tool) => {
    if (tool && !disallowedTools.includes(tool)) {
      setDisallowedTools([...disallowedTools, tool]);
      setNewDisallowedTool('');
    }
  };

  const removeDisallowedTool = (tool) => {
    setDisallowedTools(disallowedTools.filter(t => t !== tool));
  };

  // MCP form handling functions
  const resetMcpForm = () => {
    setMcpFormData({
      name: '',
      type: 'stdio',
      scope: 'user', // Default to user scope
      projectPath: '',
      config: {
        command: '',
        args: [],
        env: {},
        url: '',
        headers: {},
        timeout: 30000
      },
      jsonInput: '',
      importMode: 'form'
    });
    setEditingMcpServer(null);
    setShowMcpForm(false);
    setJsonValidationError('');
  };

  const openMcpForm = (server = null) => {
    if (server) {
      setEditingMcpServer(server);
      setMcpFormData({
        name: server.name,
        type: server.type,
        scope: server.scope,
        projectPath: server.projectPath || '',
        config: { ...server.config },
        raw: server.raw, // Store raw config for display
        importMode: 'form', // Always use form mode when editing
        jsonInput: ''
      });
    } else {
      resetMcpForm();
    }
    setShowMcpForm(true);
  };

  const handleMcpSubmit = async (e) => {
    e.preventDefault();
    
    setMcpLoading(true);
    
    try {
      if (mcpFormData.importMode === 'json') {
        // Use JSON import endpoint
        const token = localStorage.getItem('auth-token');
        const response = await fetch('/api/mcp/cli/add-json', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            name: mcpFormData.name,
            jsonConfig: mcpFormData.jsonInput,
            scope: mcpFormData.scope,
            projectPath: mcpFormData.projectPath
          })
        });
        
        if (response.ok) {
          const result = await response.json();
          if (result.success) {
            await fetchMcpServers(); // Refresh the list
            resetMcpForm();
            setSaveStatus('success');
          } else {
            throw new Error(result.error || 'Failed to add server via JSON');
          }
        } else {
          const error = await response.json();
          throw new Error(error.error || 'Failed to add server');
        }
      } else {
        // Use regular form-based save
        await saveMcpServer(mcpFormData);
        resetMcpForm();
        setSaveStatus('success');
      }
    } catch (error) {
      alert(`Error: ${error.message}`);
      setSaveStatus('error');
    } finally {
      setMcpLoading(false);
    }
  };

  const handleMcpDelete = async (serverId, scope) => {
    if (confirm('确定要删除这个 MCP 服务器吗？')) {
      try {
        await deleteMcpServer(serverId, scope);
        setSaveStatus('success');
      } catch (error) {
        alert(`Error: ${error.message}`);
        setSaveStatus('error');
      }
    }
  };

  const handleMcpTest = async (serverId, scope) => {
    try {
      setMcpTestResults({ ...mcpTestResults, [serverId]: { loading: true } });
      const result = await testMcpServer(serverId, scope);
      setMcpTestResults({ ...mcpTestResults, [serverId]: result });
    } catch (error) {
      setMcpTestResults({ 
        ...mcpTestResults, 
        [serverId]: { 
          success: false, 
          message: error.message,
          details: []
        } 
      });
    }
  };

  const handleMcpToolsDiscovery = async (serverId, scope) => {
    try {
      setMcpToolsLoading({ ...mcpToolsLoading, [serverId]: true });
      const result = await discoverMcpTools(serverId, scope);
      setMcpServerTools({ ...mcpServerTools, [serverId]: result });
    } catch (error) {
      setMcpServerTools({ 
        ...mcpServerTools, 
        [serverId]: { 
          success: false, 
          tools: [], 
          resources: [], 
          prompts: [] 
        } 
      });
    } finally {
      setMcpToolsLoading({ ...mcpToolsLoading, [serverId]: false });
    }
  };

  const updateMcpConfig = (key, value) => {
    setMcpFormData(prev => ({
      ...prev,
      config: {
        ...prev.config,
        [key]: value
      }
    }));
  };


  const getTransportIcon = (type) => {
    switch (type) {
      case 'stdio': return <Terminal className="w-4 h-4" />;
      case 'sse': return <Zap className="w-4 h-4" />;
      case 'http': return <Globe className="w-4 h-4" />;
      default: return <Server className="w-4 h-4" />;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop fixed inset-0 flex items-center justify-center z-[100] md:p-4 bg-background/95">
      <div className="bg-background border border-border md:rounded-lg shadow-xl w-full md:max-w-4xl h-full md:h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 md:p-6 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-3">
            <Settings className="w-5 h-5 md:w-6 md:h-6 text-blue-600" />
            <h2 className="text-lg md:text-xl font-semibold text-foreground">
              设置
            </h2>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground touch-manipulation"
          >
            <X className="w-5 h-5" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Tab Navigation */}
          <div className="border-b border-border">
            <div className="flex px-4 md:px-6">
              <button
                onClick={() => setActiveTab('tools')}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'tools'
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                工具
              </button>
              <button
                onClick={() => setActiveTab('api')}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'api'
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                接口
              </button>
              <button
                onClick={() => setActiveTab('network')}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'network'
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                网络
              </button>
              <button
                onClick={() => setActiveTab('appearance')}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'appearance'
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                外观
              </button>
            </div>
          </div>

          <div className="p-4 md:p-6 space-y-6 md:space-y-8 pb-safe-area-inset-bottom">
            
            {/* API Configuration Tab */}
            {activeTab === 'api' && (
              <div className="space-y-6 md:space-y-8">
                
                {/* API Provider Selection */}
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <Bot className="w-5 h-5 text-blue-500" />
                    <h3 className="text-lg font-medium text-foreground">
                      AI提供商
                    </h3>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    选择AI模型提供商和相关配置
                  </p>
                  
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    {Object.entries(API_PROVIDERS).map(([key, provider]) => (
                      <div
                        key={key}
                        className={`p-3 rounded-lg border-2 transition-all ${
                          apiConfig.provider === key
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                            : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                        }`}
                      >
                        <button
                          onClick={() => setApiConfig(prev => ({ ...prev, provider: key }))}
                          className="w-full text-center"
                        >
                          <div className="flex flex-col items-center gap-2">
                            <img 
                              src={provider.icon} 
                              alt={provider.name} 
                              className="w-8 h-8"
                              onError={(e) => {
                                e.target.src = '/icons/claude-ai-icon.svg';
                              }}
                            />
                            <div>
                              <div className="flex items-center justify-center gap-1 mb-1">
                                <span className="font-medium text-sm">{provider.name}</span>
                                {apiConfig.provider === key && (
                                  <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                                )}
                              </div>
                            </div>
                          </div>
                        </button>
                        <div className="mt-2 text-center">
                          {provider.docs && provider.docs !== '#' ? (
                            <a
                              href={provider.docs}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <span>文档</span>
                              <ExternalLink className="w-2 h-2" />
                            </a>
                          ) : (
                            <span className="text-xs text-muted-foreground">通用配置</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Model Configuration */}
                <div className="space-y-4">
                  <div>
                    <h4 className="text-md font-medium text-foreground">模型配置 
                      <span className="text-xs text-muted-foreground font-normal ml-2">(可选)</span>
                    </h4>
                    <p className="text-xs text-muted-foreground mt-1">
                      如不指定，将使用默认模型或环境变量中的配置
                    </p>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-2">
                        主模型 (ANTHROPIC_MODEL) 
                        <span className="text-xs text-muted-foreground font-normal">可选</span>
                      </label>
                      <div className="relative">
                        <Input
                          value={apiConfig.model}
                          onChange={(e) => setApiConfig(prev => ({ ...prev, model: e.target.value }))}
                          placeholder="输入模型名称"
                          className="w-full"
                        />
                        {API_PROVIDERS[apiConfig.provider]?.models.length > 0 && (
                          <div className="mt-1">
                            <div className="text-xs text-muted-foreground mb-1">常用模型:</div>
                            <div className="flex flex-wrap gap-1">
                              {API_PROVIDERS[apiConfig.provider].models.map(model => (
                                <button
                                  key={model}
                                  type="button"
                                  onClick={() => setApiConfig(prev => ({ ...prev, model }))}
                                  className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded border border-gray-200 dark:border-gray-700 transition-colors"
                                >
                                  {model}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-2">
                        小模型 (ANTHROPIC_SMALL_FAST_MODEL) 
                        <span className="text-xs text-muted-foreground font-normal">可选</span>
                      </label>
                      <div className="relative">
                        <Input
                          value={apiConfig.smallModel}
                          onChange={(e) => setApiConfig(prev => ({ ...prev, smallModel: e.target.value }))}
                          placeholder="输入小模型名称"
                          className="w-full"
                        />
                        {API_PROVIDERS[apiConfig.provider]?.models.length > 0 && (
                          <div className="mt-1">
                            <div className="text-xs text-muted-foreground mb-1">常用模型:</div>
                            <div className="flex flex-wrap gap-1">
                              {API_PROVIDERS[apiConfig.provider].models.map(model => (
                                <button
                                  key={model}
                                  type="button"
                                  onClick={() => setApiConfig(prev => ({ ...prev, smallModel: model }))}
                                  className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded border border-gray-200 dark:border-gray-700 transition-colors"
                                >
                                  {model}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* API Endpoint Configuration */}
                <div className="space-y-4">
                  <h4 className="text-md font-medium text-foreground">接口端点配置</h4>
                  
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-2">
                        Base URL (ANTHROPIC_BASE_URL)
                      </label>
                      <Input
                        value={apiConfig.baseUrl}
                        onChange={(e) => setApiConfig(prev => ({ ...prev, baseUrl: e.target.value }))}
                        placeholder="https://api.anthropic.com"
                        className="font-mono text-sm"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        留空使用默认端点，或设置代理/第三方端点
                      </p>
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-2">
                        授权密钥 (ANTHROPIC_AUTH_TOKEN)
                      </label>
                      <Input
                        type="password"
                        value={apiConfig.authToken}
                        onChange={(e) => setApiConfig(prev => ({ ...prev, authToken: e.target.value }))}
                        placeholder="your-api-key"
                        className="font-mono text-sm"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        API密钥，请妥善保管
                      </p>
                    </div>
                  </div>
                </div>



                {/* Configuration Examples */}
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                  <h4 className="font-medium text-blue-900 dark:text-blue-100 mb-3">
                    配置示例：
                  </h4>
                  <div className="space-y-3 text-sm">
                    
                    <div>
                      <div className="font-medium text-blue-800 dark:text-blue-200 mb-1">DeepSeek:</div>
                      <div className="bg-blue-100 dark:bg-blue-800 p-2 rounded font-mono text-xs">
                        <div>配置保存到 ~/.claude/claude-webui.json</div>
                        <div>claude-cli 可以读取此配置文件</div>
                      </div>
                    </div>
                    
                    <div>
                      <div className="font-medium text-blue-800 dark:text-blue-200 mb-1">环境变量 (优先级最高):</div>
                      <div className="bg-blue-100 dark:bg-blue-800 p-2 rounded font-mono text-xs">
                        <div>export ANTHROPIC_BASE_URL=https://open.bigmodel.cn/api/anthropic</div>
                        <div>export ANTHROPIC_MODEL=glm-4.5</div>
                        <div>export ANTHROPIC_AUTH_TOKEN=YOUR_API_KEY</div>
                      </div>
                    </div>
                    
                  </div>
                </div>
                
              </div>
            )}
            
            {/* Network Configuration Tab */}
            {activeTab === 'network' && (
              <div className="space-y-6 md:space-y-8">
                
                {/* Proxy Settings */}
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <Globe className="w-5 h-5 text-green-500" />
                    <h3 className="text-lg font-medium text-foreground">
                      代理配置
                    </h3>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-2">
                        HTTP代理
                      </label>
                      <Input
                        value={apiConfig.httpProxy}
                        onChange={(e) => setApiConfig(prev => ({ ...prev, httpProxy: e.target.value }))}
                        placeholder="http://localhost:10888"
                        className="font-mono text-sm"
                      />
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-2">
                        HTTPS代理
                      </label>
                      <Input
                        value={apiConfig.httpsProxy}
                        onChange={(e) => setApiConfig(prev => ({ ...prev, httpsProxy: e.target.value }))}
                        placeholder="http://localhost:10888"
                        className="font-mono text-sm"
                      />
                    </div>
                  </div>
                </div>
                
              </div>
            )}
            
            {/* Appearance Tab */}
            {activeTab === 'appearance' && (
              <div className="space-y-6 md:space-y-8">
               {activeTab === 'appearance' && (
  <div className="space-y-6 md:space-y-8">
    {/* Theme Settings */}
    <div className="space-y-4">
      <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium text-foreground">
              深色模式
            </div>
            <div className="text-sm text-muted-foreground">
              切换浅色和深色主题
            </div>
          </div>
          <button
            onClick={toggleDarkMode}
            className="relative inline-flex h-8 w-14 items-center rounded-full bg-gray-200 dark:bg-gray-700 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
            role="switch"
            aria-checked={isDarkMode}
            aria-label="Toggle dark mode"
          >
            <span className="sr-only">Toggle dark mode</span>
            <span
              className={`${
                isDarkMode ? 'translate-x-7' : 'translate-x-1'
              } inline-block h-6 w-6 transform rounded-full bg-white shadow-lg transition-transform duration-200 flex items-center justify-center`}
            >
              {isDarkMode ? (
                <Moon className="w-3.5 h-3.5 text-gray-700" />
              ) : (
                <Sun className="w-3.5 h-3.5 text-yellow-500" />
              )}
            </span>
          </button>
        </div>
      </div>
    </div>

    {/* Project Sorting */}
    <div className="space-y-4">
      <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium text-foreground">
              项目排序
            </div>
            <div className="text-sm text-muted-foreground">
              侧边栏中项目的排列方式
            </div>
          </div>
          <select
            value={projectSortOrder}
            onChange={(e) => setProjectSortOrder(e.target.value)}
            className="text-sm bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-blue-500 focus:border-blue-500 p-2 w-32"
          >
            <option value="name">按字母顺序</option>
            <option value="date">按最近活动</option>
          </select>
        </div>
      </div>
    </div>
  </div>
)}

              </div>
            )}

            {/* Tools Tab */}
            {activeTab === 'tools' && (
              <div className="space-y-6 md:space-y-8">
            
            {/* Claude Tools Content */}
            <div className="space-y-6 md:space-y-8">
            
            {/* Skip Permissions */}
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 text-orange-500" />
                <h3 className="text-lg font-medium text-foreground">
                  权限设置
                </h3>
              </div>
              <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-4">
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={skipPermissions}
                    onChange={(e) => setSkipPermissions(e.target.checked)}
                    className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <div>
                    <div className="font-medium text-orange-900 dark:text-orange-100">
                      跳过权限提示（谨慎使用）
                    </div>
                    <div className="text-sm text-orange-700 dark:text-orange-300">
                      等同于 --dangerously-skip-permissions 标志
                    </div>
                  </div>
                </label>
              </div>
            </div>

            {/* Allowed Tools */}
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Shield className="w-5 h-5 text-green-500" />
                <h3 className="text-lg font-medium text-foreground">
                  允许的工具
                </h3>
              </div>
              <p className="text-sm text-muted-foreground">
                无需权限提示即可自动允许的工具
              </p>
              
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  value={newAllowedTool}
                  onChange={(e) => setNewAllowedTool(e.target.value)}
                  placeholder='例如："Bash(git log:*)" 或 "Write"'
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') {
                      addAllowedTool(newAllowedTool);
                    }
                  }}
                  className="flex-1 h-10 touch-manipulation"
                  style={{ fontSize: '16px' }}
                />
                <Button
                  onClick={() => addAllowedTool(newAllowedTool)}
                  disabled={!newAllowedTool}
                  size="sm"
                  className="h-10 px-4 touch-manipulation"
                >
                  <Plus className="w-4 h-4 mr-2 sm:mr-0" />
                  <span className="sm:hidden">添加工具</span>
                </Button>
              </div>

              {/* Common tools quick add */}
              <div className="space-y-2">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  快速添加常用工具：
                </p>
                <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
                  {commonTools.map(tool => (
                    <Button
                      key={tool}
                      variant="outline"
                      size="sm"
                      onClick={() => addAllowedTool(tool)}
                      disabled={allowedTools.includes(tool)}
                      className="text-xs h-8 touch-manipulation truncate"
                    >
                      {tool}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                {allowedTools.map(tool => (
                  <div key={tool} className="flex items-center justify-between bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3">
                    <span className="font-mono text-sm text-green-800 dark:text-green-200">
                      {tool}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeAllowedTool(tool)}
                      className="text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
                {allowedTools.length === 0 && (
                  <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                    未配置允许的工具
                  </div>
                )}
              </div>
            </div>

            {/* Disallowed Tools */}
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 text-red-500" />
                <h3 className="text-lg font-medium text-foreground">
                  禁止的工具
                </h3>
              </div>
              <p className="text-sm text-muted-foreground">
                无需权限提示即可自动阻止的工具
              </p>
              
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  value={newDisallowedTool}
                  onChange={(e) => setNewDisallowedTool(e.target.value)}
                  placeholder='例如："Bash(rm:*)" 或 "Write"'
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') {
                      addDisallowedTool(newDisallowedTool);
                    }
                  }}
                  className="flex-1 h-10 touch-manipulation"
                  style={{ fontSize: '16px' }}
                />
                <Button
                  onClick={() => addDisallowedTool(newDisallowedTool)}
                  disabled={!newDisallowedTool}
                  size="sm"
                  className="h-10 px-4 touch-manipulation"
                >
                  <Plus className="w-4 h-4 mr-2 sm:mr-0" />
                  <span className="sm:hidden">添加工具</span>
                </Button>
              </div>

              <div className="space-y-2">
                {disallowedTools.map(tool => (
                  <div key={tool} className="flex items-center justify-between bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
                    <span className="font-mono text-sm text-red-800 dark:text-red-200">
                      {tool}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeDisallowedTool(tool)}
                      className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
                {disallowedTools.length === 0 && (
                  <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                    未配置禁止的工具
                  </div>
                )}
              </div>
            </div>

            {/* Help Section */}
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
              <h4 className="font-medium text-blue-900 dark:text-blue-100 mb-2">
                工具模式示例：
              </h4>
              <ul className="text-sm text-blue-800 dark:text-blue-200 space-y-1">
                <li><code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">"Bash(git log:*)"</code> - 允许所有 git log 命令</li>
                <li><code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">"Bash(git diff:*)"</code> - 允许所有 git diff 命令</li>
                <li><code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">"Write"</code> - 允许所有 Write 工具使用</li>
                <li><code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">"Read"</code> - 允许所有 Read 工具使用</li>
                <li><code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">"Bash(rm:*)"</code> - 阻止所有 rm 命令（危险）</li>
              </ul>
            </div>

            {/* MCP Server Management */}
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Server className="w-5 h-5 text-purple-500" />
                <h3 className="text-lg font-medium text-foreground">
                  MCP 服务器
                </h3>
              </div>
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  模型上下文协议服务器为 Claude 提供额外的工具和数据源
                </p>
              </div>
              
              <div className="flex justify-between items-center">
                <Button
                  onClick={() => openMcpForm()}
                  className="bg-purple-600 hover:bg-purple-700 text-white"
                  size="sm"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  添加 MCP 服务器
                </Button>
              </div>

              {/* MCP Servers List */}
              <div className="space-y-2">
                {mcpServers.map(server => (
                  <div key={server.id} className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          {getTransportIcon(server.type)}
                          <span className="font-medium text-foreground">{server.name}</span>
                          <Badge variant="outline" className="text-xs">
                            {server.type}
                          </Badge>
                          <Badge variant="outline" className="text-xs">
                            {server.scope === 'local' ? '📁 local' : server.scope === 'user' ? '👤 user' : server.scope}
                          </Badge>
                          {server.projectPath && (
                            <Badge variant="outline" className="text-xs bg-purple-50 dark:bg-purple-900/20" title={server.projectPath}>
                              {server.projectPath.split('/').pop()}
                            </Badge>
                          )}
                        </div>
                        
                        <div className="text-sm text-muted-foreground space-y-1">
                          {server.type === 'stdio' && server.config.command && (
                            <div>命令: <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded text-xs">{server.config.command}</code></div>
                          )}
                          {(server.type === 'sse' || server.type === 'http') && server.config.url && (
                            <div>URL: <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded text-xs">{server.config.url}</code></div>
                          )}
                          {server.config.args && server.config.args.length > 0 && (
                            <div>参数: <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded text-xs">{server.config.args.join(' ')}</code></div>
                          )}
                          {server.config.env && Object.keys(server.config.env).length > 0 && (
                            <div>环境: <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded text-xs">{Object.entries(server.config.env).map(([k, v]) => `${k}=${v}`).join(', ')}</code></div>
                          )}
                          {server.raw && (
                            <details className="mt-2">
                              <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">查看完整配置</summary>
                              <pre className="mt-1 text-xs bg-gray-100 dark:bg-gray-800 p-2 rounded overflow-x-auto">
                                {JSON.stringify(server.raw, null, 2)}
                              </pre>
                            </details>
                          )}
                        </div>

                        {/* Test Results */}
                        {mcpTestResults[server.id] && (
                          <div className={`mt-2 p-2 rounded text-xs ${
                            mcpTestResults[server.id].success 
                              ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200' 
                              : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200'
                          }`}>
                            <div className="font-medium">{mcpTestResults[server.id].message}</div>
                            {mcpTestResults[server.id].details && mcpTestResults[server.id].details.length > 0 && (
                              <ul className="mt-1 space-y-0.5">
                                {mcpTestResults[server.id].details.map((detail, i) => (
                                  <li key={i}>• {detail}</li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}

                        {/* Tools Discovery Results */}
                        {mcpServerTools[server.id] && (
                          <div className="mt-2 p-2 rounded text-xs bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-200 border border-blue-200 dark:border-blue-800">
                            <div className="font-medium mb-2">可用工具和资源</div>
                            
                            {mcpServerTools[server.id].tools && mcpServerTools[server.id].tools.length > 0 && (
                              <div className="mb-2">
                                <div className="font-medium text-xs mb-1">工具 ({mcpServerTools[server.id].tools.length}):</div>
                                <ul className="space-y-0.5">
                                  {mcpServerTools[server.id].tools.map((tool, i) => (
                                    <li key={i} className="flex items-start gap-1">
                                      <span className="text-blue-400 mt-0.5">•</span>
                                      <div>
                                        <code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">{tool.name}</code>
                                        {tool.description && tool.description !== 'No description provided' && (
                                          <span className="ml-1 text-xs opacity-75">- {tool.description}</span>
                                        )}
                                      </div>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {mcpServerTools[server.id].resources && mcpServerTools[server.id].resources.length > 0 && (
                              <div className="mb-2">
                                <div className="font-medium text-xs mb-1">资源 ({mcpServerTools[server.id].resources.length}):</div>
                                <ul className="space-y-0.5">
                                  {mcpServerTools[server.id].resources.map((resource, i) => (
                                    <li key={i} className="flex items-start gap-1">
                                      <span className="text-blue-400 mt-0.5">•</span>
                                      <div>
                                        <code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">{resource.name}</code>
                                        {resource.description && resource.description !== 'No description provided' && (
                                          <span className="ml-1 text-xs opacity-75">- {resource.description}</span>
                                        )}
                                      </div>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {mcpServerTools[server.id].prompts && mcpServerTools[server.id].prompts.length > 0 && (
                              <div>
                                <div className="font-medium text-xs mb-1">提示词 ({mcpServerTools[server.id].prompts.length}):</div>
                                <ul className="space-y-0.5">
                                  {mcpServerTools[server.id].prompts.map((prompt, i) => (
                                    <li key={i} className="flex items-start gap-1">
                                      <span className="text-blue-400 mt-0.5">•</span>
                                      <div>
                                        <code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">{prompt.name}</code>
                                        {prompt.description && prompt.description !== 'No description provided' && (
                                          <span className="ml-1 text-xs opacity-75">- {prompt.description}</span>
                                        )}
                                      </div>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {(!mcpServerTools[server.id].tools || mcpServerTools[server.id].tools.length === 0) &&
                             (!mcpServerTools[server.id].resources || mcpServerTools[server.id].resources.length === 0) &&
                             (!mcpServerTools[server.id].prompts || mcpServerTools[server.id].prompts.length === 0) && (
                              <div className="text-xs opacity-75">未发现工具、资源或提示词</div>
                            )}
                          </div>
                        )}
                      </div>
                      
                      <div className="flex items-center gap-2 ml-4">
                        <Button
                          onClick={() => openMcpForm(server)}
                          variant="ghost"
                          size="sm"
                          className="text-gray-600 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
                          title="编辑服务器"
                        >
                          <Edit3 className="w-4 h-4" />
                        </Button>
                        <Button
                          onClick={() => handleMcpDelete(server.id, server.scope)}
                          variant="ghost"
                          size="sm"
                          className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                          title="删除服务器"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
                {mcpServers.length === 0 && (
                  <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                    未配置 MCP 服务器
                  </div>
                )}
              </div>
            </div>

            {/* MCP Server Form Modal */}
            {showMcpForm && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[110] p-4">
                <div className="bg-background border border-border rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                  <div className="flex items-center justify-between p-4 border-b border-border">
                    <h3 className="text-lg font-medium text-foreground">
                      {editingMcpServer ? '编辑 MCP 服务器' : '添加 MCP 服务器'}
                    </h3>
                    <Button variant="ghost" size="sm" onClick={resetMcpForm}>
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                  
                  <form onSubmit={handleMcpSubmit} className="p-4 space-y-4">

                    {!editingMcpServer && (
                    <div className="flex gap-2 mb-4">
                      <button
                        type="button"
                        onClick={() => setMcpFormData(prev => ({...prev, importMode: 'form'}))}
                        className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                          mcpFormData.importMode === 'form'
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                        }`}
                      >
                        表单输入
                      </button>
                      <button
                        type="button"
                        onClick={() => setMcpFormData(prev => ({...prev, importMode: 'json'}))}
                        className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                          mcpFormData.importMode === 'json'
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                        }`}
                      >
                        JSON 导入
                      </button>
                    </div>
                    )}

                    {/* Show current scope when editing */}
                    {mcpFormData.importMode === 'form' && editingMcpServer && (
                      <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                        <label className="block text-sm font-medium text-foreground mb-2">
                          作用域
                        </label>
                        <div className="flex items-center gap-2">
                          {mcpFormData.scope === 'user' ? <Globe className="w-4 h-4" /> : <FolderOpen className="w-4 h-4" />}
                          <span className="text-sm">
                            {mcpFormData.scope === 'user' ? '用户（全局）' : '项目（本地）'}
                          </span>
                          {mcpFormData.scope === 'local' && mcpFormData.projectPath && (
                            <span className="text-xs text-muted-foreground">
                              - {mcpFormData.projectPath}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-2">
                          编辑现有服务器时不能更改作用域
                        </p>
                      </div>
                    )}

                    {/* Scope Selection - Moved to top, disabled when editing */}
                    {mcpFormData.importMode === 'form' && !editingMcpServer && (
                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-foreground mb-2">
                            作用域 *
                          </label>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => setMcpFormData(prev => ({...prev, scope: 'user', projectPath: ''}))}
                              className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${
                                mcpFormData.scope === 'user'
                                  ? 'bg-blue-600 text-white'
                                  : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                              }`}
                            >
                              <div className="flex items-center justify-center gap-2">
                                <Globe className="w-4 h-4" />
                                <span>用户（全局）</span>
                              </div>
                            </button>
                            <button
                              type="button"
                              onClick={() => setMcpFormData(prev => ({...prev, scope: 'local'}))}
                              className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${
                                mcpFormData.scope === 'local'
                                  ? 'bg-blue-600 text-white'
                                  : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                              }`}
                            >
                              <div className="flex items-center justify-center gap-2">
                                <FolderOpen className="w-4 h-4" />
                                <span>项目（本地）</span>
                              </div>
                            </button>
                          </div>
                          <p className="text-xs text-muted-foreground mt-2">
                            {mcpFormData.scope === 'user' 
                              ? '用户作用域：在您机器上的所有项目中可用'
                              : '本地作用域：仅在选定的项目中可用'
                            }
                          </p>
                        </div>

                        {/* Project Selection for Local Scope */}
                        {mcpFormData.scope === 'local' && !editingMcpServer && (
                          <div>
                            <label className="block text-sm font-medium text-foreground mb-2">
                              项目 *
                            </label>
                            <select
                              value={mcpFormData.projectPath}
                              onChange={(e) => setMcpFormData(prev => ({...prev, projectPath: e.target.value}))}
                              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                              required={mcpFormData.scope === 'local'}
                            >
                              <option value="">选择一个项目...</option>
                              {projects.map(project => (
                                <option key={project.name} value={project.path || project.fullPath}>
                                  {project.displayName || project.name}
                                </option>
                              ))}
                            </select>
                            {mcpFormData.projectPath && (
                              <p className="text-xs text-muted-foreground mt-1">
                                路径：{mcpFormData.projectPath}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Basic Info */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className={mcpFormData.importMode === 'json' ? 'md:col-span-2' : ''}>
                        <label className="block text-sm font-medium text-foreground mb-2">
                          服务器名称 *
                        </label>
                        <Input
                          value={mcpFormData.name}
                          onChange={(e) => {
                            setMcpFormData(prev => ({...prev, name: e.target.value}));
                          }}
                          placeholder="我的服务器"
                          required
                        />
                      </div>
                      
                      {mcpFormData.importMode === 'form' && (
                        <div>
                          <label className="block text-sm font-medium text-foreground mb-2">
                            传输类型 *
                          </label>
                          <select
                            value={mcpFormData.type}
                            onChange={(e) => {
                              setMcpFormData(prev => ({...prev, type: e.target.value}));
                            }}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                          >
                            <option value="stdio">stdio</option>
                            <option value="sse">SSE</option>
                            <option value="http">HTTP</option>
                          </select>
                        </div>
                      )}
                    </div>


                    {/* Show raw configuration details when editing */}
                    {editingMcpServer && mcpFormData.raw && mcpFormData.importMode === 'form' && (
                      <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                        <h4 className="text-sm font-medium text-foreground mb-2">
                          配置详情（来自 {editingMcpServer.scope === 'global' ? '~/.claude.json' : '项目配置'}）
                        </h4>
                        <pre className="text-xs bg-gray-100 dark:bg-gray-800 p-3 rounded overflow-x-auto">
                          {JSON.stringify(mcpFormData.raw, null, 2)}
                        </pre>
                      </div>
                    )}

                    {/* JSON Import Mode */}
                    {mcpFormData.importMode === 'json' && (
                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-foreground mb-2">
                            JSON 配置 *
                          </label>
                          <textarea
                            value={mcpFormData.jsonInput}
                            onChange={(e) => {
                              setMcpFormData(prev => ({...prev, jsonInput: e.target.value}));
                              // Validate JSON as user types
                              try {
                                if (e.target.value.trim()) {
                                  const parsed = JSON.parse(e.target.value);
                                  // Basic validation
                                  if (!parsed.type) {
                                    setJsonValidationError('缺少必需字段: type');
                                  } else if (parsed.type === 'stdio' && !parsed.command) {
                                    setJsonValidationError('stdio 类型需要 command 字段');
                                  } else if ((parsed.type === 'http' || parsed.type === 'sse') && !parsed.url) {
                                    setJsonValidationError(`${parsed.type} 类型需要 url 字段`);
                                  } else {
                                    setJsonValidationError('');
                                  }
                                }
                              } catch (err) {
                                if (e.target.value.trim()) {
                                  setJsonValidationError('无效的 JSON 格式');
                                } else {
                                  setJsonValidationError('');
                                }
                              }
                            }}
                            className={`w-full px-3 py-2 border ${jsonValidationError ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'} bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-blue-500 focus:border-blue-500 font-mono text-sm`}
                            rows="8"
                            placeholder={'{\n  "type": "stdio",\n  "command": "/path/to/server",\n  "args": ["--api-key", "abc123"],\n  "env": {\n    "CACHE_DIR": "/tmp"\n  }\n}'}
                            required
                          />
                          {jsonValidationError && (
                            <p className="text-xs text-red-500 mt-1">{jsonValidationError}</p>
                          )}
                          <p className="text-xs text-muted-foreground mt-2">
                            粘贴您的 MCP 服务器 JSON 格式配置。示例格式:
                            <br />• stdio: {`{"type":"stdio","command":"npx","args":["@upstash/context7-mcp"]}`}
                            <br />• http/sse: {`{"type":"http","url":"https://api.example.com/mcp"}`}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Transport-specific Config - Only show in form mode */}
                    {mcpFormData.importMode === 'form' && mcpFormData.type === 'stdio' && (
                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-foreground mb-2">
                            命令 *
                          </label>
                          <Input
                            value={mcpFormData.config.command}
                            onChange={(e) => updateMcpConfig('command', e.target.value)}
                            placeholder="/path/to/mcp-server"
                            required
                          />
                        </div>
                        
                        <div>
                          <label className="block text-sm font-medium text-foreground mb-2">
                            参数（每行一个）
                          </label>
                          <textarea
                            value={Array.isArray(mcpFormData.config.args) ? mcpFormData.config.args.join('\n') : ''}
                            onChange={(e) => updateMcpConfig('args', e.target.value.split('\n').filter(arg => arg.trim()))}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                            rows="3"
                            placeholder="--api-key&#10;abc123"
                          />
                        </div>
                      </div>
                    )}

                    {mcpFormData.importMode === 'form' && (mcpFormData.type === 'sse' || mcpFormData.type === 'http') && (
                      <div>
                        <label className="block text-sm font-medium text-foreground mb-2">
                          URL *
                        </label>
                        <Input
                          value={mcpFormData.config.url}
                          onChange={(e) => updateMcpConfig('url', e.target.value)}
                          placeholder="https://api.example.com/mcp"
                          type="url"
                          required
                        />
                      </div>
                    )}

                    {/* Environment Variables - Only show in form mode */}
                    {mcpFormData.importMode === 'form' && (
                      <div>
                      <label className="block text-sm font-medium text-foreground mb-2">
                        环境变量（KEY=value，每行一个）
                      </label>
                      <textarea
                        value={Object.entries(mcpFormData.config.env || {}).map(([k, v]) => `${k}=${v}`).join('\n')}
                        onChange={(e) => {
                          const env = {};
                          e.target.value.split('\n').forEach(line => {
                            const [key, ...valueParts] = line.split('=');
                            if (key && key.trim()) {
                              env[key.trim()] = valueParts.join('=').trim();
                            }
                          });
                          updateMcpConfig('env', env);
                        }}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                        rows="3"
                        placeholder="API_KEY=your-key&#10;DEBUG=true"
                      />
                    </div>
                    )}

                    {mcpFormData.importMode === 'form' && (mcpFormData.type === 'sse' || mcpFormData.type === 'http') && (
                      <div>
                        <label className="block text-sm font-medium text-foreground mb-2">
                          请求头（KEY=value，每行一个）
                        </label>
                        <textarea
                          value={Object.entries(mcpFormData.config.headers || {}).map(([k, v]) => `${k}=${v}`).join('\n')}
                          onChange={(e) => {
                            const headers = {};
                            e.target.value.split('\n').forEach(line => {
                              const [key, ...valueParts] = line.split('=');
                              if (key && key.trim()) {
                                headers[key.trim()] = valueParts.join('=').trim();
                              }
                            });
                            updateMcpConfig('headers', headers);
                          }}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                          rows="3"
                          placeholder="Authorization=Bearer token&#10;X-API-Key=your-key"
                        />
                      </div>
                    )}


                    <div className="flex justify-end gap-2 pt-4">
                      <Button type="button" variant="outline" onClick={resetMcpForm}>
                        取消
                      </Button>
                      <Button 
                        type="submit" 
                        disabled={mcpLoading} 
                        className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50"
                      >
                        {mcpLoading ? '保存中...' : (editingMcpServer ? '更新服务器' : '添加服务器')}
                      </Button>
                    </div>
                  </form>
                </div>
              </div>
            )}
            </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-4 md:p-6 border-t border-border flex-shrink-0 gap-3 pb-safe-area-inset-bottom">
          <div className="flex items-center justify-center sm:justify-start gap-2 order-2 sm:order-1">
            {saveStatus === 'success' && (
              <div className="text-green-600 dark:text-green-400 text-sm flex items-center gap-1">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                设置保存成功！
              </div>
            )}
            {saveStatus === 'error' && (
              <div className="text-red-600 dark:text-red-400 text-sm flex items-center gap-1">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                保存设置失败
              </div>
            )}
          </div>
          <div className="flex items-center gap-3 order-1 sm:order-2">
            <Button 
              variant="outline" 
              onClick={onClose} 
              disabled={isSaving}
              className="flex-1 sm:flex-none h-10 touch-manipulation"
            >
              取消
            </Button>
            <Button 
              onClick={saveSettings} 
              disabled={isSaving}
              className="flex-1 sm:flex-none h-10 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 touch-manipulation"
            >
              {isSaving ? (
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  保存中...
                </div>
              ) : (
                '保存设置'
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ToolsSettings;
