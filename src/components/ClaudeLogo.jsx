import React, { useState, useEffect } from 'react';
import { getCurrentProvider } from '../utils/apiConfig';

const ClaudeLogo = ({className = 'w-5 h-5'}) => {
  const [provider, setProvider] = useState({
    name: 'Claude',
    icon: '/icons/claude-ai-icon.svg',
    provider: 'claude'
  });

  useEffect(() => {
    const loadProvider = async () => {
      try {
        const currentProvider = await getCurrentProvider();
        setProvider(currentProvider);
      } catch (error) {
        console.error('Error loading provider config:', error);
        // Keep default Claude config on error
      }
    };

    loadProvider();

    // 监听配置变化事件
    const handleConfigChange = () => {
      loadProvider();
    };
    window.addEventListener('apiConfigChanged', handleConfigChange);

    return () => {
      window.removeEventListener('apiConfigChanged', handleConfigChange);
    };
  }, []);

  return (
    <img 
      src={provider.icon} 
      alt={provider.name} 
      className={className}
      onError={(e) => {
        // 如果图标加载失败，回退到Claude图标
        e.target.src = '/icons/claude-ai-icon.svg';
        e.target.alt = 'Claude';
      }}
    />
  );
};

export default ClaudeLogo;


