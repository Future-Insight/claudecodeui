import React, { useState, useEffect, useRef } from 'react';
import { Terminal, X, RotateCcw, ExternalLink, Minimize2, Maximize2 } from 'lucide-react';
import { authenticatedFetch } from '../utils/api';

function PreviewLogs({ selectedProject, isOpen, onClose, isMobile }) {
  const [logs, setLogs] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [isServerRunning, setIsServerRunning] = useState(false);
  const logsContainerRef = useRef(null);
  const refreshIntervalRef = useRef(null);

  useEffect(() => {
    if (isOpen && selectedProject) {
      fetchLogs();
      
      if (autoRefresh) {
        refreshIntervalRef.current = setInterval(fetchLogs, 2000);
      }
    }
    
    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, [isOpen, selectedProject, autoRefresh]);

  // 自动滚动到底部
  useEffect(() => {
    if (logsContainerRef.current && logs.length > 0) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [logs]);

  const fetchLogs = async () => {
    if (!selectedProject) return;
    
    setIsLoading(true);
    try {
      const response = await authenticatedFetch(`/api/project/${encodeURIComponent(selectedProject.name)}/preview/logs`);
      const data = await response.json();
      
      if (response.ok) {
        setLogs(data.logs || []);
        setIsServerRunning(data.running || false);
      } else {
        console.error('获取日志失败:', data.error);
      }
    } catch (error) {
      console.error('获取日志时出错:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const openLogsPage = () => {
    // 在新窗口中打开日志页面
    const url = `/logs/${encodeURIComponent(selectedProject.name)}`;
    window.open(url, '_blank');
  };

  // 处理ANSI颜色代码的函数
  const parseAnsiColors = (text) => {
    // 简单的ANSI颜色代码映射
    const ansiColorMap = {
      '30': '#000000', '31': '#e74c3c', '32': '#2ecc71', '33': '#f39c12',
      '34': '#3498db', '35': '#9b59b6', '36': '#1abc9c', '37': '#ecf0f1',
      '90': '#7f8c8d', '91': '#ff6b6b', '92': '#51cf66', '93': '#ffd93d',
      '94': '#74c0fc', '95': '#da77f2', '96': '#4ecdc4', '97': '#ffffff'
    };

    // 移除ANSI转义序列并保留颜色信息
    return text.replace(/\x1b\[[0-9;]*m/g, (match) => {
      const colorCode = match.match(/\x1b\[([0-9;]+)m/);
      if (colorCode && ansiColorMap[colorCode[1]]) {
        return `<span style="color: ${ansiColorMap[colorCode[1]]}">`;
      }
      return match === '\x1b[0m' ? '</span>' : '';
    });
  };

  const formatLogLine = (log, index) => {
    const timestamp = new Date(log.timestamp).toLocaleTimeString();
    const isError = log.type === 'stderr';
    const icon = isError ? '❌' : '✅';
    
    // 处理日志内容中的ANSI颜色代码
    const processedContent = parseAnsiColors(log.data.trim());
    
    return (
      <div
        key={index}
        className={`font-mono text-sm py-2 px-4 ${
          isError 
            ? 'bg-red-900/20 border-l-4 border-red-500' 
            : 'bg-green-900/20 border-l-4 border-green-500'
        }`}
      >
        <div className="flex items-start gap-2">
          <span className="text-xs">{icon}</span>
          <div className="flex-1">
            <div className="text-xs text-gray-400 mb-1">
              [{timestamp}] [{log.type.toUpperCase()}]
            </div>
            <div 
              className={`whitespace-pre-wrap break-words leading-relaxed ${
                isError ? 'text-red-300' : 'text-green-300'
              }`}
              dangerouslySetInnerHTML={{ __html: processedContent }}
            />
          </div>
        </div>
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className={`bg-gray-900 rounded-lg shadow-2xl ${
        isMobile ? 'w-full h-full' : 'w-4/5 h-4/5 max-w-6xl'
      } flex flex-col overflow-hidden border border-gray-700`}>
        
        {/* 终端头部 - 模拟macOS终端样式 */}
        <div className="bg-gray-800 px-4 py-3 border-b border-gray-700">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* 终端按钮 */}
              <div className="flex gap-2">
                <div className="w-3 h-3 rounded-full bg-red-500"></div>
                <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                <div className="w-3 h-3 rounded-full bg-green-500"></div>
              </div>
              
              <div className="flex items-center gap-2 ml-4">
                <Terminal className="w-4 h-4 text-green-400" />
                <span className="text-sm font-medium text-gray-300">
                  {selectedProject?.name} - 预览服务器日志
                </span>
                <div className={`w-2 h-2 rounded-full ${
                  isServerRunning ? 'bg-green-400 animate-pulse' : 'bg-gray-500'
                }`}></div>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              {/* 自动刷新开关 */}
              <label className="flex items-center gap-2 text-xs text-gray-400">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                  className="w-3 h-3 rounded bg-gray-700 border-gray-600"
                />
                <span>自动刷新</span>
              </label>
              
              {/* 操作按钮 */}
              <button
                onClick={fetchLogs}
                className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded text-xs"
                title="刷新"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
              
              <button
                onClick={openLogsPage}
                className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded text-xs"
                title="在新窗口查看日志"
              >
                <ExternalLink className="w-3 h-3" />
              </button>
              
              <button
                onClick={onClose}
                className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded text-xs"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>
        
        {/* 终端内容区域 */}
        <div className="flex-1 bg-black overflow-hidden">
          {logs.length === 0 ? (
            <div className="h-full flex items-center justify-center text-gray-500">
              <div className="text-center">
                <Terminal className="w-16 h-16 mx-auto mb-4 opacity-30" />
                <p className="text-lg font-mono">$ waiting for output...</p>
                <p className="text-sm mt-2 opacity-70">启动预览服务器后将显示运行日志</p>
              </div>
            </div>
          ) : (
            <div 
              ref={logsContainerRef}
              className="h-full overflow-y-auto scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-900"
            >
              <div className="p-2">
                {logs.map((log, index) => formatLogLine(log, index))}
              </div>
            </div>
          )}
        </div>
        
        {/* 终端状态栏 */}
        <div className="bg-gray-800 px-4 py-2 border-t border-gray-700">
          <div className="flex items-center justify-between text-xs text-gray-400">
            <div className="flex items-center gap-4">
              <span className="font-mono">lines: {logs.length}</span>
              {autoRefresh && isServerRunning && (
                <span className="flex items-center gap-1">
                  <div className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse"></div>
                  live
                </span>
              )}
              {isLoading && (
                <span className="animate-pulse">refreshing...</span>
              )}
            </div>
            
            <div className="font-mono">
              status: {isServerRunning ? 'running' : 'stopped'} | auto-scroll: on
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PreviewLogs;