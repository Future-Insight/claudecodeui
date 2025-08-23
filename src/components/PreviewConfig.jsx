import React, { useState, useEffect } from 'react';
import { X, Save, Loader, Check, AlertTriangle, Globe, Settings } from 'lucide-react';
import { authenticatedFetch } from '../utils/api';

const FRAMEWORK_PRESETS = [
  { name: 'React', port: 3000, command: 'npm start', directory: '' },
  { name: 'Vite', port: 5173, command: 'npm run dev', directory: '' },
  { name: 'Next.js', port: 3000, command: 'npm run dev', directory: '' },
  { name: 'Vue', port: 8080, command: 'npm run serve', directory: '' },
  { name: 'Angular', port: 4200, command: 'npm start', directory: '' },
  { name: 'Nuxt', port: 3000, command: 'npm run dev', directory: '' },
];

function PreviewConfig({ selectedProject, isOpen, onClose, onSave, isMobile }) {
  const [config, setConfig] = useState({ dev: { port: 3000, command: 'npm run dev', directory: '' } });
  const [globalConfig, setGlobalConfig] = useState({ host: 'localhost', openInNewTab: true });
  const [activeTab, setActiveTab] = useState('project');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [detectedConfig, setDetectedConfig] = useState(null);

  useEffect(() => {
    if (isOpen) {
      if (selectedProject) {
        loadConfig();
      }
      loadGlobalConfig();
    }
  }, [isOpen, selectedProject]);

  const loadConfig = async () => {
    setIsLoading(true);
    setError('');
    
    try {
      const response = await authenticatedFetch(`/api/project/${encodeURIComponent(selectedProject.name)}/preview/config`);
      const data = await response.json();
      
      if (data.success) {
        if (data.config) {
          setConfig(data.config);
        } else if (data.detected) {
          // 如果没有现有配置但检测到了配置，显示检测到的配置
          setDetectedConfig(data.detected);
          setConfig({ dev: data.detected });
        }
      } else {
        setError(data.error || '加载配置失败');
      }
    } catch (error) {
      console.error('Error loading config:', error);
      setError('加载配置时发生错误');
    } finally {
      setIsLoading(false);
    }
  };

  const loadGlobalConfig = async () => {
    try {
      const response = await authenticatedFetch('/api/global-config');
      const data = await response.json();
      
      if (data.success) {
        setGlobalConfig(data.config);
      }
    } catch (error) {
      console.error('Error loading global config:', error);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError('');

    try {
      if (activeTab === 'project') {
        if (!config.dev?.port || !config.dev?.command) {
          setError('请填写端口号和启动命令');
          return;
        }

        if (config.dev.port < 1024 || config.dev.port > 65535) {
          setError('端口号必须在 1024-65535 之间');
          return;
        }

        const response = await authenticatedFetch(`/api/project/${encodeURIComponent(selectedProject.name)}/preview/config`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ config })
        });

        const data = await response.json();
        if (data.success) {
          onSave && onSave(config);
          onClose();
        } else {
          setError(data.error || '保存配置失败');
        }
      } else {
        // 保存全局配置
        if (!globalConfig.host?.trim()) {
          setError('请填写主机地址');
          return;
        }

        const response = await authenticatedFetch('/api/global-config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ config: globalConfig })
        });

        const data = await response.json();
        if (data.success) {
          onClose();
        } else {
          setError(data.error || '保存全局配置失败');
        }
      }
    } catch (error) {
      console.error('Error saving config:', error);
      setError('保存配置时发生错误');
    } finally {
      setIsSaving(false);
    }
  };

  const handlePresetSelect = (preset) => {
    setConfig({
      dev: {
        port: preset.port,
        command: preset.command,
        directory: preset.directory || ''
      }
    });
    setError('');
  };

  const handleInputChange = (field, value) => {
    setConfig(prev => ({
      ...prev,
      dev: {
        ...prev.dev,
        [field]: field === 'port' ? parseInt(value) || 0 : value
      }
    }));
    setError('');
  };

  const handleGlobalConfigChange = (field, value) => {
    setGlobalConfig(prev => ({
      ...prev,
      [field]: field === 'openInNewTab' ? Boolean(value) : value
    }));
    setError('');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className={`bg-white dark:bg-gray-800 rounded-lg shadow-xl ${
        isMobile 
          ? 'mx-4 max-w-sm w-full max-h-[90vh] overflow-y-auto' 
          : 'max-w-2xl w-full mx-6 max-h-[90vh] overflow-y-auto'
      }`}>
        
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            预览配置
          </h3>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-gray-200 dark:border-gray-700">
          <button
            onClick={() => setActiveTab('project')}
            disabled={!selectedProject}
            className={`flex-1 px-4 py-3 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
              activeTab === 'project'
                ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white disabled:opacity-50 disabled:cursor-not-allowed'
            }`}
          >
            <Settings className="w-4 h-4" />
            <span>项目配置</span>
          </button>
          <button
            onClick={() => setActiveTab('global')}
            className={`flex-1 px-4 py-3 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
              activeTab === 'global'
                ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            <Globe className="w-4 h-4" />
            <span>全局配置</span>
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader className="w-6 h-6 animate-spin text-blue-500" />
              <span className="ml-2">加载配置中...</span>
            </div>
          ) : activeTab === 'project' ? (
            <>
              {/* 检测到的配置提示 */}
              {detectedConfig && (
                <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                  <div className="flex items-center gap-2 mb-2">
                    <Check className="w-4 h-4 text-blue-600" />
                    <span className="font-medium text-blue-900 dark:text-blue-100">
                      检测到 {detectedConfig.type} 项目
                    </span>
                  </div>
                  <p className="text-sm text-blue-700 dark:text-blue-200">
                    我们已自动为您配置了推荐的开发服务器设置。您可以根据需要进行调整。
                  </p>
                </div>
              )}

              {/* 框架预设 */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                  快速设置
                </label>
                <div className={`grid ${isMobile ? 'grid-cols-2' : 'grid-cols-3'} gap-2`}>
                  {FRAMEWORK_PRESETS.map((preset) => (
                    <button
                      key={preset.name}
                      onClick={() => handlePresetSelect(preset)}
                      className={`p-3 text-center border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${
                        config.dev?.port === preset.port && 
                        config.dev?.command === preset.command &&
                        (config.dev?.directory || '') === (preset.directory || '')
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                          : 'border-gray-200 dark:border-gray-600'
                      }`}
                    >
                      <div className="font-medium text-sm">{preset.name}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        {preset.command} (:{preset.port})
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* 手动配置 */}
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    端口号 *
                  </label>
                  <input
                    type="number"
                    min="1024"
                    max="65535"
                    value={config.dev?.port || ''}
                    onChange={(e) => handleInputChange('port', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="3000"
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    开发服务器运行的端口 (1024-65535)
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    启动命令 *
                  </label>
                  <input
                    type="text"
                    value={config.dev?.command || ''}
                    onChange={(e) => handleInputChange('command', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="npm run dev"
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    启动开发服务器的命令
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    工作目录
                  </label>
                  <input
                    type="text"
                    value={config.dev?.directory || ''}
                    onChange={(e) => handleInputChange('directory', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="留空使用项目根目录"
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    开发服务器运行的子目录（相对于项目根目录），留空则在项目根目录运行
                  </p>
                </div>
              </div>

              {/* 错误提示 */}
              {error && (
                <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-red-600" />
                    <span className="text-sm text-red-700 dark:text-red-200">{error}</span>
                  </div>
                </div>
              )}

              {/* 预览配置 */}
              {config.dev?.port && config.dev?.command && (
                <div className="mt-6 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                  <h4 className="font-medium text-gray-900 dark:text-white mb-2">配置预览</h4>
                  <div className="text-sm text-gray-600 dark:text-gray-300 space-y-1">
                    <div>端口: <span className="font-mono">{config.dev.port}</span></div>
                    <div>命令: <span className="font-mono">{config.dev.command}</span></div>
                    <div>工作目录: <span className="font-mono">{config.dev.directory || '项目根目录'}</span></div>
                    <div>访问: <span className="font-mono">http://localhost:{config.dev.port}</span></div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              {/* 全局配置内容 */}
              <div className="space-y-6">
                <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                  <div className="flex items-center gap-2 mb-2">
                    <Globe className="w-4 h-4 text-blue-600" />
                    <span className="font-medium text-blue-900 dark:text-blue-100">
                      全局预览设置
                    </span>
                  </div>
                  <p className="text-sm text-blue-700 dark:text-blue-200">
                    这些设置将应用于所有项目的预览功能。
                  </p>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      主机地址 *
                    </label>
                    <input
                      type="text"
                      value={globalConfig.host || ''}
                      onChange={(e) => handleGlobalConfigChange('host', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="localhost"
                    />
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      预览服务器的主机地址。使用具体IP地址支持局域网访问（如 192.168.1.100）
                    </p>
                  </div>

                  <div>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={globalConfig.openInNewTab}
                        onChange={(e) => handleGlobalConfigChange('openInNewTab', e.target.checked)}
                        className="rounded border-gray-300 dark:border-gray-600 text-blue-600 dark:text-blue-500 focus:ring-blue-500 dark:focus:ring-blue-400 dark:bg-gray-800"
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300">
                        在新标签页中打开预览
                      </span>
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 ml-6">
                      启用此选项将始终在新浏览器标签页中打开预览链接
                    </p>
                  </div>
                </div>

                {/* 预览全局配置 */}
                <div className="mt-6 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                  <h4 className="font-medium text-gray-900 dark:text-white mb-2">配置预览</h4>
                  <div className="text-sm text-gray-600 dark:text-gray-300 space-y-1">
                    <div>主机: <span className="font-mono">{globalConfig.host || 'localhost'}</span></div>
                    <div>新标签页打开: <span className="font-mono">{globalConfig.openInNewTab ? '是' : '否'}</span></div>
                    <div>示例访问地址: <span className="font-mono">http://{globalConfig.host || 'localhost'}:3000</span></div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className={`flex ${isMobile ? 'flex-col gap-2' : 'justify-end gap-3'} p-6 border-t border-gray-200 dark:border-gray-700`}>
          <button
            onClick={onClose}
            disabled={isSaving}
            className={`${isMobile ? 'w-full' : 'px-6'} py-2 text-gray-600 hover:text-gray-800 dark:text-gray-300 dark:hover:text-white disabled:opacity-50`}
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={
              isSaving || isLoading || 
              (activeTab === 'project' && (!config.dev?.port || !config.dev?.command)) ||
              (activeTab === 'global' && !globalConfig.host?.trim())
            }
            className={`${isMobile ? 'w-full' : 'px-6'} py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2`}
          >
            {isSaving ? (
              <>
                <Loader className="w-4 h-4 animate-spin" />
                保存中...
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                保存配置
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default PreviewConfig;