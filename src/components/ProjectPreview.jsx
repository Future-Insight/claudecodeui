import React, { useState, useEffect, useRef } from 'react';
import { Globe, Play, Square, Settings, RefreshCw, ExternalLink, AlertCircle, CheckCircle, Loader, Copy, Monitor, Terminal } from 'lucide-react';
import { authenticatedFetch } from '../utils/api';
import PreviewConfig from './PreviewConfig';
import PreviewLogs from './PreviewLogs';

function ProjectPreview({ selectedProject, isMobile }) {
  const [config, setConfig] = useState(null);
  const [serverStatus, setServerStatus] = useState('stopped');
  const [isLoading, setIsLoading] = useState(true);
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const [globalConfig, setGlobalConfig] = useState({ host: 'localhost', openInNewTab: true });
  const [error, setError] = useState('');
  const [showErrorModal, setShowErrorModal] = useState(false);
  const statusCheckIntervalRef = useRef(null);

  useEffect(() => {
    if (selectedProject) {
      loadConfig();
      checkServerStatus();
      
      // 定期检查服务器状态
      statusCheckIntervalRef.current = setInterval(checkServerStatus, 3000);
    }
    
    return () => {
      if (statusCheckIntervalRef.current) {
        clearInterval(statusCheckIntervalRef.current);
      }
    };
  }, [selectedProject]);

  useEffect(() => {
    if (config && serverStatus === 'running') {
      fetchPreviewUrl();
    } else {
      setPreviewUrl('');
    }
  }, [config, serverStatus, selectedProject]);

  const fetchPreviewUrl = async () => {
    if (!selectedProject || serverStatus !== 'running') return;
    
    try {
      const response = await authenticatedFetch(`/api/preview/${encodeURIComponent(selectedProject.name)}/url`);
      const data = await response.json();
      
      if (data.success) {
        setPreviewUrl(data.url);
        setGlobalConfig({
          host: data.host,
          openInNewTab: data.openInNewTab
        });
      }
    } catch (error) {
      console.error('Error fetching preview URL:', error);
    }
  };

  const loadConfig = async () => {
    if (!selectedProject) return;
    
    setIsLoading(true);
    try {
      const response = await authenticatedFetch(`/api/project/${encodeURIComponent(selectedProject.name)}/preview/config`);
      const data = await response.json();
      
      if (data.success) {
        setConfig(data.config);
      } else {
        console.error('Failed to load config:', data.error);
      }
    } catch (error) {
      console.error('Error loading config:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const checkServerStatus = async () => {
    if (!selectedProject) return;
    
    try {
      const response = await authenticatedFetch(`/api/project/${encodeURIComponent(selectedProject.name)}/preview/status`);
      const data = await response.json();
      
      if (data.running) {
        setServerStatus('running');
      } else {
        setServerStatus('stopped');
      }
    } catch (error) {
      setServerStatus('error');
    }
  };

  const startServer = async () => {
    if (!selectedProject || !config) return;
    
    setIsStarting(true);
    setError('');
    try {
      const response = await authenticatedFetch(`/api/project/${encodeURIComponent(selectedProject.name)}/preview/start`, {
        method: 'POST'
      });
      
      const data = await response.json();
      if (data.success) {
        setServerStatus('running');
        // 延迟一下获取预览URL
        setTimeout(() => {
          fetchPreviewUrl();
        }, 2000);
      } else {
        console.error('Failed to start server:', data.error);
        setError(data.error || '启动开发服务器失败');
        setShowErrorModal(true);
        setServerStatus('error');
      }
    } catch (error) {
      console.error('Error starting server:', error);
      setError('启动开发服务器时发生错误');
      setShowErrorModal(true);
      setServerStatus('error');
    } finally {
      setIsStarting(false);
    }
  };

  const stopServer = async () => {
    if (!selectedProject) return;
    
    setIsStopping(true);
    try {
      const response = await authenticatedFetch(`/api/project/${encodeURIComponent(selectedProject.name)}/preview/stop`, {
        method: 'POST'
      });
      
      const data = await response.json();
      if (data.success) {
        setServerStatus('stopped');
        setPreviewUrl('');
      } else {
        console.error('Failed to stop server:', data.error);
      }
    } catch (error) {
      console.error('Error stopping server:', error);
    } finally {
      setIsStopping(false);
    }
  };

  const openInNewTab = () => {
    if (previewUrl) {
      window.open(previewUrl, '_blank');
    }
  };

  const copyToClipboard = async () => {
    if (previewUrl) {
      try {
        await navigator.clipboard.writeText(previewUrl);
        // 这里可以添加一个临时的复制成功提示
      } catch (error) {
        console.error('Failed to copy to clipboard:', error);
      }
    }
  };

  const renderStatusIndicator = () => {
    switch (serverStatus) {
      case 'running':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'stopped':
        return <Square className="w-4 h-4 text-gray-400" />;
      case 'error':
        return <AlertCircle className="w-4 h-4 text-red-500" />;
      default:
        return <Loader className="w-4 h-4 text-blue-500 animate-spin" />;
    }
  };

  const renderConfigPrompt = () => (
    <div className="h-full flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-800 p-6">
      <div className="max-w-md text-center">
        <Globe className="w-16 h-16 mx-auto mb-6 text-gray-400" />
        <h3 className="text-xl font-semibold mb-3 text-gray-900 dark:text-white">
          配置开发服务器
        </h3>
        <p className="text-gray-600 dark:text-gray-300 mb-6">
          为此项目配置开发服务器以启用实时预览功能。我们会自动检测常见的框架配置。
        </p>
        <button
          onClick={() => setShowConfig(true)}
          className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2 mx-auto"
        >
          <Settings className="w-4 h-4" />
          配置服务器
        </button>
      </div>
    </div>
  );

  const renderPreviewContent = () => {
    if (serverStatus === 'running' && previewUrl) {
      return (
        <div className="h-full flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-800 p-6">
          <div className="max-w-md text-center">
            <div className="mb-6">
              <div className="w-20 h-20 mx-auto mb-4 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center">
                <Monitor className="w-10 h-10 text-green-600 dark:text-green-400" />
              </div>
              {renderStatusIndicator()}
              <h3 className="text-xl font-semibold mb-2 mt-4 text-gray-900 dark:text-white">
                开发服务器运行中
              </h3>
              <p className="text-gray-600 dark:text-gray-300 mb-6">
                你的项目正在 {globalConfig.host}:{config?.dev?.port} 端口运行
              </p>
            </div>

            {/* 预览URL信息 */}
            <div className="bg-white dark:bg-gray-700 rounded-lg p-4 mb-6 border border-gray-200 dark:border-gray-600">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">预览地址</span>
                <button
                  onClick={copyToClipboard}
                  className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
                  title="复制链接"
                >
                  <Copy className="w-4 h-4" />
                </button>
              </div>
              <div className="font-mono text-sm bg-gray-100 dark:bg-gray-800 p-2 rounded border text-center break-all">
                {previewUrl}
              </div>
            </div>

            {/* 操作按钮 */}
            <div className={`flex ${isMobile ? 'flex-col gap-3' : 'gap-4'} mb-4`}>
              <button
                onClick={openInNewTab}
                className={`${isMobile ? 'w-full' : 'flex-1'} px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center justify-center gap-2`}
              >
                <ExternalLink className="w-4 h-4" />
                在新标签页打开
              </button>
              <button
                onClick={() => setShowLogs(true)}
                className={`${isMobile ? 'w-full' : 'flex-1'} px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 flex items-center justify-center gap-2`}
              >
                <Terminal className="w-4 h-4" />
                查看日志
              </button>
              <button
                onClick={() => setShowConfig(true)}
                className={`${isMobile ? 'w-full' : 'flex-1'} px-6 py-3 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center justify-center gap-2`}
              >
                <Settings className="w-4 h-4" />
                配置
              </button>
            </div>

            {/* 停止服务器按钮 */}
            <button
              onClick={stopServer}
              disabled={isStopping}
              className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center gap-2 mx-auto"
            >
              {isStopping ? <Loader className="w-4 h-4 animate-spin" /> : <Square className="w-4 h-4" />}
              停止服务器
            </button>

            {/* 服务器信息 */}
            <div className="mt-6 text-xs text-gray-500 dark:text-gray-400 space-y-1">
              <div>命令: {config?.dev?.command}</div>
              <div>端口: {config?.dev?.port}</div>
              <div>主机: {globalConfig.host}</div>
            </div>
          </div>
        </div>
      );
    }
    
    // 服务器未运行时的状态
    return (
      <div className="h-full flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-800 p-6">
        <div className="max-w-md text-center">
          {renderStatusIndicator()}
          <h3 className="text-lg font-semibold mb-3 mt-4 text-gray-900 dark:text-white">
            开发服务器已停止
          </h3>
          <p className="text-gray-600 dark:text-gray-300 mb-6">
            启动开发服务器以预览你的项目。
          </p>
          <div className={`flex ${isMobile ? 'flex-col gap-2' : 'gap-3'}`}>
            <button
              onClick={startServer}
              disabled={isStarting}
              className={`${isMobile ? 'w-full' : 'flex-1'} px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2`}
            >
              {isStarting ? <Loader className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {isStarting ? '启动中...' : '启动服务器'}
            </button>
            <button
              onClick={() => setShowLogs(true)}
              className={`${isMobile ? 'w-full' : 'flex-1'} px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 flex items-center justify-center gap-2`}
            >
              <Terminal className="w-4 h-4" />
              查看日志
            </button>
            <button
              onClick={() => setShowConfig(true)}
              className={`${isMobile ? 'w-full' : 'flex-1'} px-6 py-3 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center justify-center gap-2`}
            >
              <Settings className="w-4 h-4" />
              配置
            </button>
          </div>
          {config && (
            <div className="mt-4 text-sm text-gray-500 dark:text-gray-400">
              命令: {config.dev?.command} | 端口: {config.dev?.port}
            </div>
          )}
        </div>
      </div>
    );
  };

  if (!selectedProject) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500 dark:text-gray-400">
        <p>选择一个项目以查看预览</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center text-gray-500 dark:text-gray-400">
          <Loader className="w-8 h-8 mx-auto mb-2 animate-spin" />
          <p>加载配置中...</p>
        </div>
      </div>
    );
  }

  
  return (
    <div className="h-full flex flex-col bg-white dark:bg-gray-900">
      {!config ? renderConfigPrompt() : renderPreviewContent()}
      
      {/* 配置模态框 - 始终渲染 */}
      <PreviewConfig
        selectedProject={selectedProject}
        isOpen={showConfig}
        onClose={() => setShowConfig(false)}
        onSave={(newConfig) => {
          setConfig(newConfig);
          // 重新检查服务器状态
          checkServerStatus();
        }}
        isMobile={isMobile}
      />
      
      {/* 日志模态框 */}
      <PreviewLogs
        selectedProject={selectedProject}
        isOpen={showLogs}
        onClose={() => setShowLogs(false)}
        isMobile={isMobile}
      />
      
      {/* 错误提示模态框 */}
      {showErrorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className={`bg-white dark:bg-gray-800 rounded-lg shadow-xl ${
            isMobile 
              ? 'mx-4 max-w-sm w-full' 
              : 'max-w-md w-full mx-6'
          }`}>
            
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                启动失败
              </h3>
              <button
                onClick={() => setShowErrorModal(false)}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <AlertCircle className="w-6 h-6 text-red-500" />
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">
                    开发服务器启动失败
                  </p>
                  <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                    {error}
                  </p>
                </div>
              </div>
              
              <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-4 border border-red-200 dark:border-red-800">
                <h4 className="font-medium text-red-900 dark:text-red-100 mb-2">
                  可能的解决方案：
                </h4>
                <ul className="text-sm text-red-700 dark:text-red-200 space-y-1">
                  <li>• 检查项目目录是否存在依赖文件</li>
                  <li>• 确认端口是否被其他程序占用</li>
                  <li>• 验证启动命令是否正确</li>
                  <li>• 查看日志了解详细错误信息</li>
                </ul>
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-3 p-6 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={() => {
                  setShowErrorModal(false);
                  setShowLogs(true);
                }}
                className="px-4 py-2 text-gray-600 hover:text-gray-800 dark:text-gray-300 dark:hover:text-white"
              >
                查看日志
              </button>
              <button
                onClick={() => {
                  setShowErrorModal(false);
                  setShowConfig(true);
                }}
                className="px-4 py-2 text-gray-600 hover:text-gray-800 dark:text-gray-300 dark:hover:text-white"
              >
                检查配置
              </button>
              <button
                onClick={() => setShowErrorModal(false)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ProjectPreview;