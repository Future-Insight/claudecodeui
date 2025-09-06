import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { ClipboardAddon } from '@xterm/addon-clipboard';
import { WebglAddon } from '@xterm/addon-webgl';
import 'xterm/css/xterm.css';

// CSS to remove xterm focus outline and optimize mobile input
const xtermStyles = `
  .xterm .xterm-screen {
    outline: none !important;
  }
  .xterm:focus .xterm-screen {
    outline: none !important;
  }
  .xterm-screen:focus {
    outline: none !important;
  }
  
  /* Mobile optimization styles */
  @media (max-width: 768px) {
    /* Prevent zoom on input focus on mobile */
    .xterm textarea,
    .xterm input {
      font-size: 16px !important;
    }
    
    /* Improve touch scrolling */
    .xterm .xterm-viewport {
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      overscroll-behavior-y: contain;
      touch-action: pan-y;
    }
    
    /* Better mobile keyboard experience */
    .xterm .xterm-helper-textarea {
      font-size: 16px !important;
      opacity: 0;
      position: fixed;
      left: -9999px;
      top: 0;
      width: 1px;
      height: 1px;
      z-index: -10;
      pointer-events: none;
    }
    
    /* Optimize terminal screen for mobile */
    .xterm .xterm-screen {
      touch-action: manipulation;
    }
  }
  
  /* Prevent page scroll when navigating selections in terminal */
  .shell-container.selection-mode {
    touch-action: pan-y pinch-zoom;
    overflow: hidden;
    overscroll-behavior: contain;
  }
  
  .shell-container.selection-mode .xterm-viewport {
    touch-action: pan-y;
    overscroll-behavior-y: contain;
  }
`;

// Inject styles
if (typeof document !== 'undefined') {
  const styleSheet = document.createElement('style');
  styleSheet.type = 'text/css';
  styleSheet.innerText = xtermStyles;
  document.head.appendChild(styleSheet);
}

// Global store for shell sessions to persist across tab switches
const shellSessions = new Map();

// Session history storage for better persistence
const SESSION_HISTORY_KEY = 'claude-shell-history';

// Helper functions for session history
const saveSessionHistory = (sessionKey, data) => {
  try {
    const history = JSON.parse(localStorage.getItem(SESSION_HISTORY_KEY) || '{}');
    history[sessionKey] = {
      ...data,
      timestamp: Date.now()
    };
    localStorage.setItem(SESSION_HISTORY_KEY, JSON.stringify(history));
  } catch (error) {
    console.warn('Failed to save session history:', error);
  }
};

const getSessionHistory = (sessionKey) => {
  try {
    const history = JSON.parse(localStorage.getItem(SESSION_HISTORY_KEY) || '{}');
    return history[sessionKey] || null;
  } catch (error) {
    console.warn('Failed to get session history:', error);
    return null;
  }
};

const clearOldSessionHistory = () => {
  try {
    const history = JSON.parse(localStorage.getItem(SESSION_HISTORY_KEY) || '{}');
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000; // 24 hours

    const cleaned = {};
    for (const [key, value] of Object.entries(history)) {
      if (now - value.timestamp < oneDay) {
        cleaned[key] = value;
      }
    }
    localStorage.setItem(SESSION_HISTORY_KEY, JSON.stringify(cleaned));
  } catch (error) {
    console.warn('Failed to clear old session history:', error);
  }
};

function Shell({ selectedProject, selectedSession, isActive }) {
  const terminalRef = useRef(null);
  const shellContainerRef = useRef(null);
  const terminal = useRef(null);
  const fitAddon = useRef(null);
  const ws = useRef(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [lastSessionId, setLastSessionId] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [sessionHistory, setSessionHistory] = useState(null);
  const [shellStatus, setShellStatus] = useState({ exists: false });
  const [remoteSessionTerminated, setRemoteSessionTerminated] = useState(false);
  const [isSelectionMode, setIsSelectionMode] = useState(false);

  // Check shell session status for current project
  const checkShellStatus = async () => {
    if (!selectedProject) return;

    try {
      const token = localStorage.getItem('auth-token');
      const response = await fetch(`/api/projects/${selectedProject.name}/shell-status`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const status = await response.json();
        setShellStatus(status);
        //console.log('Shell status:', status);
      }
    } catch (error) {
      console.error('Failed to check shell status:', error);
    }
  };

  // Kill shell session for current project
  const killShellSession = async () => {
    if (!selectedProject) return;

    try {
      const token = localStorage.getItem('auth-token');
      const response = await fetch(`/api/projects/${selectedProject.name}/shell`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        console.log('Shell session terminated successfully');
        await checkShellStatus(); // Refresh status
      } else {
        console.error('Failed to terminate shell session');
      }
    } catch (error) {
      console.error('Error terminating shell session:', error);
    }
  };

  // Toggle fullscreen mode
  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);

    // Fit terminal after fullscreen toggle
    setTimeout(() => {
      if (fitAddon.current && terminal.current) {
        fitAddon.current.fit();
        // Send updated terminal size to backend after fullscreen toggle
        if (ws.current && ws.current.readyState === WebSocket.OPEN) {
          ws.current.send(JSON.stringify({
            type: 'resize',
            cols: terminal.current.cols,
            rows: terminal.current.rows,
            sessionId: selectedSession?.id
          }));
        }
      }
    }, 100);
  };


  // Connect to shell function (with Claude CLI)
  const connectToShell = () => {
    if (!isInitialized || isConnected || isConnecting) return;

    setIsConnecting(true);
    setRemoteSessionTerminated(false); // Clear remote termination state

    // Start the WebSocket connection
    connectWebSocket();
  };

  // Connect to plain shell function (without Claude CLI, no server caching)
  const connectToPlainShell = () => {
    if (!isInitialized || isConnected || isConnecting) return;

    setIsConnecting(true);
    setRemoteSessionTerminated(false); // Clear remote termination state

    // Start the WebSocket connection for plain shell
    connectPlainWebSocket();
  };

  // Disconnect from shell function
  const disconnectFromShell = () => {

    if (ws.current) {
      ws.current.close();
      ws.current = null;
    }

    // Clear terminal content completely
    if (terminal.current) {
      terminal.current.clear();
      terminal.current.write('\x1b[2J\x1b[H'); // Clear screen and move cursor to home
    }

    setIsConnected(false);
    setIsConnecting(false);
  };


  // Watch for session changes - but don't disconnect since we use one shell per project
  useEffect(() => {
    const currentSessionId = selectedSession?.id || null;
    setLastSessionId(currentSessionId);
  }, [selectedSession?.id]);

  // Periodically check shell status
  useEffect(() => {
    if (!selectedProject) return;

    // 立即检查一次
    checkShellStatus();

    // 每10秒检查一次状态
    const interval = setInterval(checkShellStatus, 10000);
    return () => clearInterval(interval);
  }, [selectedProject]);

  // Initialize terminal when component mounts
  useEffect(() => {
    // Clean old session history on component mount
    clearOldSessionHistory();

    if (!terminalRef.current || !selectedProject) {
      return;
    }

    // Create session key for this project
    const sessionKey = `project-${selectedProject.name}`;

    // Check if we have an existing session
    const existingSession = shellSessions.get(sessionKey);
    const historyData = getSessionHistory(sessionKey);

    // Set session history for display
    if (historyData && !isConnected) {
      setSessionHistory(historyData);
    }

    if (existingSession && !terminal.current) {

      try {
        // Reuse existing terminal
        terminal.current = existingSession.terminal;
        fitAddon.current = existingSession.fitAddon;
        ws.current = existingSession.ws;
        setIsConnected(existingSession.isConnected);

        // Reattach to DOM - dispose existing element first if needed
        if (terminal.current.element && terminal.current.element.parentNode) {
          terminal.current.element.parentNode.removeChild(terminal.current.element);
        }

        terminal.current.open(terminalRef.current);

        setTimeout(() => {
          if (fitAddon.current) {
            fitAddon.current.fit();
            // Send terminal size to backend after reattaching
            if (ws.current && ws.current.readyState === WebSocket.OPEN) {
              ws.current.send(JSON.stringify({
                type: 'resize',
                cols: terminal.current.cols,
                rows: terminal.current.rows,
                sessionId: selectedSession?.id
              }));
            }
          }
        }, 100);

        setIsInitialized(true);
        return;
      } catch (error) {
        // Clear the broken session and continue to create a new one
        shellSessions.delete(sessionKey);
        terminal.current = null;
        fitAddon.current = null;
        ws.current = null;
      }
    }

    if (terminal.current) {
      return;
    }


    // Initialize new terminal
    terminal.current = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      allowProposedApi: true, // Required for clipboard addon
      allowTransparency: false,
      convertEol: true,
      scrollback: 10000,
      tabStopWidth: 4,
      // Enable scrolling and history
      scrollOnUserInput: true,
      fastScrollModifier: 'alt',
      fastScrollSensitivity: 5,
      scrollSensitivity: 1,
      // Enable full color support
      windowsMode: false,
      macOptionIsMeta: true,
      macOptionClickForcesSelection: false,
      // Enhanced theme with full 16-color ANSI support + true colors
      theme: {
        // Basic colors
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#ffffff',
        cursorAccent: '#1e1e1e',
        selection: '#264f78',
        selectionForeground: '#ffffff',

        // Standard ANSI colors (0-7)
        black: '#000000',
        red: '#cd3131',
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: '#2472c8',
        magenta: '#bc3fbc',
        cyan: '#11a8cd',
        white: '#e5e5e5',

        // Bright ANSI colors (8-15)
        brightBlack: '#666666',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#f5f543',
        brightBlue: '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan: '#29b8db',
        brightWhite: '#ffffff',

        // Extended colors for better Claude output
        extendedAnsi: [
          // 16-color palette extension for 256-color support
          '#000000', '#800000', '#008000', '#808000',
          '#000080', '#800080', '#008080', '#c0c0c0',
          '#808080', '#ff0000', '#00ff00', '#ffff00',
          '#0000ff', '#ff00ff', '#00ffff', '#ffffff'
        ]
      }
    });

    fitAddon.current = new FitAddon();
    const clipboardAddon = new ClipboardAddon();
    const webglAddon = new WebglAddon();

    terminal.current.loadAddon(fitAddon.current);
    terminal.current.loadAddon(clipboardAddon);

    try {
      terminal.current.loadAddon(webglAddon);
    } catch (error) {
    }

    terminal.current.open(terminalRef.current);

    // Wait for terminal to be fully rendered, then fit
    setTimeout(() => {
      if (fitAddon.current) {
        fitAddon.current.fit();
      }
    }, 50);

    // Add keyboard shortcuts for copy/paste and scrolling
    terminal.current.attachCustomKeyEventHandler((event) => {
      // Ctrl+C or Cmd+C for copy (when text is selected)
      if ((event.ctrlKey || event.metaKey) && event.key === 'c' && terminal.current.hasSelection()) {
        navigator.clipboard.writeText(terminal.current.getSelection());
        return false;
      }

      // Ctrl+V or Cmd+V for paste
      if ((event.ctrlKey || event.metaKey) && event.key === 'v') {
        navigator.clipboard.readText().then(text => {
          if (ws.current && ws.current.readyState === WebSocket.OPEN) {
            ws.current.send(JSON.stringify({
              type: 'input',
              data: text
            }));
          }
        }).catch(() => {
          // Failed to read clipboard
        });
        return false;
      }

      // Page Up/Down for scrolling
      if (event.key === 'PageUp') {
        terminal.current.scrollToTop();
        return false;
      }

      if (event.key === 'PageDown') {
        terminal.current.scrollToBottom();
        return false;
      }

      // Enhanced arrow key handling for selection navigation
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        // 检查当前是否在一个选择列表环境中
        // 如果Shift键按下，执行滚动而不是发送方向键到shell
        if (event.shiftKey) {
          if (event.key === 'ArrowUp') {
            terminal.current.scrollLines(-1);
          } else {
            terminal.current.scrollLines(1);
          }
          return false;
        }
        
        // 检测是否处于选择模式（通过分析终端输出）
        const buffer = terminal.current.buffer.active;
        const cursorY = buffer.cursorY;
        const currentLine = buffer.getLine(cursorY);
        
        if (currentLine && currentLine.translateToString) {
          const lineText = currentLine.translateToString();
          // 检测常见的选择提示模式
          const isSelectionContext = 
            lineText.includes('►') || 
            lineText.includes('▼') ||
            lineText.includes('→') ||
            lineText.includes('>') ||
            /^\s*[\d+\)\]]\s/.test(lineText) ||  // 数字列表
            /^\s*[-*•]\s/.test(lineText) ||      // 项目符号列表
            lineText.includes('[Y/n]') ||
            lineText.includes('(y/N)') ||
            lineText.includes('Select:') ||
            lineText.includes('Choose:');
            
          if (isSelectionContext) {
            // 设置选择模式状态
            if (!isSelectionMode) {
              setIsSelectionMode(true);
              if (shellContainerRef.current) {
                shellContainerRef.current.classList.add('selection-mode');
              }
            }
            
            // 阻止页面滚动
            event.preventDefault();
            event.stopPropagation();
            
            // 发送方向键到终端
            if (ws.current && ws.current.readyState === WebSocket.OPEN) {
              const keyCode = event.key === 'ArrowUp' ? '\u001b[A' : '\u001b[B';
              ws.current.send(JSON.stringify({
                type: 'input',
                data: keyCode
              }));
            }
            return false;
          } else {
            // 退出选择模式
            if (isSelectionMode) {
              setIsSelectionMode(false);
              if (shellContainerRef.current) {
                shellContainerRef.current.classList.remove('selection-mode');
              }
            }
          }
        }
      }

      // Shift + Page Up/Down for line-by-line scrolling (fallback)
      if (event.shiftKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        if (event.key === 'ArrowUp') {
          terminal.current.scrollLines(-1);
        } else {
          terminal.current.scrollLines(1);
        }
        return false;
      }

      return true;
    });

    // Ensure terminal takes full space and notify backend of size
    setTimeout(() => {
      if (fitAddon.current) {
        fitAddon.current.fit();
        // Send terminal size to backend after fitting
        if (terminal.current && ws.current && ws.current.readyState === WebSocket.OPEN) {
          ws.current.send(JSON.stringify({
            type: 'resize',
            cols: terminal.current.cols,
            rows: terminal.current.rows,
            sessionId: selectedSession?.id
          }));
        }
      }
    }, 100);

    setIsInitialized(true);

    // Handle terminal input
    terminal.current.onData((data) => {
      if (ws.current && ws.current.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify({
          type: 'input',
          data: data
        }));
      }
    });

    // Add resize observer to handle container size changes
    const resizeObserver = new ResizeObserver(() => {
      if (fitAddon.current && terminal.current) {
        setTimeout(() => {
          fitAddon.current.fit();
          // Send updated terminal size to backend after resize
          if (ws.current && ws.current.readyState === WebSocket.OPEN) {
            ws.current.send(JSON.stringify({
              type: 'resize',
              cols: terminal.current.cols,
              rows: terminal.current.rows,
              sessionId: selectedSession?.id
            }));
          }
        }, 50);
      }
    });

    if (terminalRef.current) {
      resizeObserver.observe(terminalRef.current);
    }

    return () => {
      resizeObserver.disconnect();

      // Store session for reuse instead of disposing
      if (terminal.current && selectedProject) {
        const sessionKey = `project-${selectedProject.name}`;

        try {
          const sessionData = {
            terminal: terminal.current,
            fitAddon: fitAddon.current,
            ws: ws.current,
            isConnected: isConnected
          };

          shellSessions.set(sessionKey, sessionData);

          // Also save to localStorage for persistence across page reloads
          saveSessionHistory(sessionKey, {
            projectName: selectedProject.name,
            projectPath: selectedProject.fullPath || selectedProject.path,
            isConnected: isConnected,
            lastActive: Date.now()
          });

        } catch (error) {
        }
      }
    };
  }, [terminalRef.current, selectedProject]);

  // Fit terminal when tab becomes active
  useEffect(() => {
    if (!isActive || !isInitialized) return;

    // Fit terminal when tab becomes active and notify backend
    setTimeout(() => {
      if (fitAddon.current) {
        fitAddon.current.fit();
        // Send terminal size to backend after tab activation
        if (terminal.current && ws.current && ws.current.readyState === WebSocket.OPEN) {
          ws.current.send(JSON.stringify({
            type: 'resize',
            cols: terminal.current.cols,
            rows: terminal.current.rows,
            sessionId: selectedSession?.id
          }));
        }
      }
    }, 100);
  }, [isActive, isInitialized]);

  // WebSocket connection function (called manually) - with Claude CLI
  const connectWebSocket = async () => {
    if (isConnecting || isConnected) return;

    try {
      // Get authentication token
      const token = localStorage.getItem('auth-token');
      if (!token) {
        console.error('No authentication token found for Shell WebSocket connection');
        return;
      }

      // Fetch server configuration to get the correct WebSocket URL
      let wsBaseUrl;
      try {
        const configResponse = await fetch('/api/config', {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        const config = await configResponse.json();
        wsBaseUrl = config.wsUrl;

        // If the config returns localhost but we're not on localhost, use current host but with API server port
        if (wsBaseUrl.includes('localhost') && !window.location.hostname.includes('localhost')) {
          const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
          // For development, API server is typically on port 3002 when Vite is on 3001
          const apiPort = window.location.port === '3001' ? '3002' : window.location.port;
          wsBaseUrl = `${protocol}//${window.location.hostname}:${apiPort}`;
        }
      } catch (error) {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        // For development, API server is typically on port 3002 when Vite is on 3001
        const apiPort = window.location.port === '3001' ? '3002' : window.location.port;
        wsBaseUrl = `${protocol}//${window.location.hostname}:${apiPort}`;
      }

      // Include token in WebSocket URL as query parameter
      const wsUrl = `${wsBaseUrl}/shell?token=${encodeURIComponent(token)}`;

      ws.current = new WebSocket(wsUrl);

      ws.current.onopen = () => {
        setIsConnected(true);
        setIsConnecting(false);
        setSessionHistory(null); // Clear history info when connected

        // Focus the terminal for keyboard input
        if (terminal.current) {
          terminal.current.focus();
        }

        // Wait for terminal to be ready, then fit and send dimensions
        setTimeout(() => {
          if (fitAddon.current && terminal.current) {
            // Force a fit to ensure proper dimensions
            fitAddon.current.fit();

            // Wait a bit more for fit to complete, then send dimensions
            setTimeout(() => {
              const initPayload = {
                type: 'init',
                projectPath: selectedProject.fullPath || selectedProject.path,
                sessionId: selectedSession?.id,
                hasSession: !!selectedSession,
                provider: selectedSession?.__provider || 'claude',
                cols: terminal.current.cols,
                rows: terminal.current.rows
              };

              ws.current.send(JSON.stringify(initPayload));

              // Also send resize message immediately after init
              setTimeout(() => {
                if (terminal.current && ws.current && ws.current.readyState === WebSocket.OPEN) {
                  ws.current.send(JSON.stringify({
                    type: 'resize',
                    cols: terminal.current.cols,
                    rows: terminal.current.rows,
                    sessionId: selectedSession?.id
                  }));
                }
              }, 100);
            }, 50);
          }
        }, 200);
      };

      ws.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'output') {
            // Check for URLs in the output and make them clickable
            const urlRegex = /(https?:\/\/[^\s\x1b\x07]+)/g;
            let output = data.data;

            // Check if this is a remote session termination message
            if (output.includes('Remote Shell session terminated by user')) {
              setRemoteSessionTerminated(true);
              setIsConnected(false);
              // Don't clear the terminal, just show the termination message
            }

            // Find URLs in the text (excluding ANSI escape sequences)
            const urls = [];
            let match;
            while ((match = urlRegex.exec(output.replace(/\x1b\[[0-9;]*m/g, ''))) !== null) {
              urls.push(match[1]);
            }

            // If URLs found, log them for potential opening

            terminal.current.write(output);
          } else if (data.type === 'url_open') {
            // Handle explicit URL opening requests from server
            window.open(data.url, '_blank');
          }
        } catch (error) {
        }
      };

      ws.current.onclose = (event) => {
        setIsConnected(false);
        setIsConnecting(false);

        // Clear terminal content when connection closes
        if (terminal.current) {
          terminal.current.clear();
          terminal.current.write('\x1b[2J\x1b[H'); // Clear screen and move cursor to home
        }

        // Don't auto-reconnect anymore - user must manually connect
      };

      ws.current.onerror = (error) => {
        setIsConnected(false);
        setIsConnecting(false);
      };
    } catch (error) {
      setIsConnected(false);
      setIsConnecting(false);
    }
  };

  // Plain WebSocket connection function - no Claude CLI, no server caching
  const connectPlainWebSocket = async () => {
    if (isConnecting || isConnected) return;

    try {
      // Get authentication token
      const token = localStorage.getItem('auth-token');
      if (!token) {
        console.error('No authentication token found for Plain Shell WebSocket connection');
        return;
      }

      // Fetch server configuration to get the correct WebSocket URL
      let wsBaseUrl;
      try {
        const configResponse = await fetch('/api/config', {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        const config = await configResponse.json();
        wsBaseUrl = config.wsUrl;

        // If the config returns localhost but we're not on localhost, use current host but with API server port
        if (wsBaseUrl.includes('localhost') && !window.location.hostname.includes('localhost')) {
          const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
          // For development, API server is typically on port 3002 when Vite is on 3001
          const apiPort = window.location.port === '3001' ? '3002' : window.location.port;
          wsBaseUrl = `${protocol}//${window.location.hostname}:${apiPort}`;
        }
      } catch (error) {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        // For development, API server is typically on port 3002 when Vite is on 3001
        const apiPort = window.location.port === '3001' ? '3002' : window.location.port;
        wsBaseUrl = `${protocol}//${window.location.hostname}:${apiPort}`;
      }

      // Use plain-shell endpoint without caching, include token in WebSocket URL as query parameter
      const wsUrl = `${wsBaseUrl}/plain-shell?token=${encodeURIComponent(token)}`;

      ws.current = new WebSocket(wsUrl);

      ws.current.onopen = () => {
        setIsConnected(true);
        setIsConnecting(false);
        setSessionHistory(null); // Clear history info when connected

        // Focus the terminal for keyboard input
        if (terminal.current) {
          terminal.current.focus();
        }

        // Wait for terminal to be ready, then fit and send dimensions
        setTimeout(() => {
          if (fitAddon.current && terminal.current) {
            // Force a fit to ensure proper dimensions
            fitAddon.current.fit();

            // Wait a bit more for fit to complete, then send dimensions
            setTimeout(() => {
              const initPayload = {
                type: 'init',
                projectPath: selectedProject.fullPath || selectedProject.path,
                isPlainShell: true, // Flag to indicate plain shell mode
                cols: terminal.current.cols,
                rows: terminal.current.rows
              };

              ws.current.send(JSON.stringify(initPayload));

              // Also send resize message immediately after init
              setTimeout(() => {
                if (terminal.current && ws.current && ws.current.readyState === WebSocket.OPEN) {
                  ws.current.send(JSON.stringify({
                    type: 'resize',
                    cols: terminal.current.cols,
                    rows: terminal.current.rows
                  }));
                }
              }, 100);
            }, 50);
          }
        }, 200);
      };

      ws.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'output') {
            terminal.current.write(data.data);
          }
        } catch (error) {
        }
      };

      ws.current.onclose = (event) => {
        setIsConnected(false);
        setIsConnecting(false);

        // Clear terminal content when connection closes
        if (terminal.current) {
          terminal.current.clear();
          terminal.current.write('\x1b[2J\x1b[H'); // Clear screen and move cursor to home
        }
      };

      ws.current.onerror = (error) => {
        setIsConnected(false);
        setIsConnecting(false);
      };
    } catch (error) {
      setIsConnected(false);
      setIsConnecting(false);
    }
  };


  if (!selectedProject) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center text-gray-500 dark:text-gray-400">
          <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
            <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold mb-2">选择项目</h3>
          <p>选择一个项目以在该目录中打开交互式终端</p>
        </div>
      </div>
    );
  }

  return (
    <div 
      ref={shellContainerRef}
      className={`shell-container h-full flex flex-col bg-gray-900 w-full ${isFullscreen ? 'fixed inset-0 z-50' : ''} ${isSelectionMode ? 'selection-mode' : ''}`}
    >
      {/* Header */}
      <div className="flex-shrink-0 bg-gray-800 border-b border-gray-700 px-2 sm:px-4 py-1 sm:py-2">
        {/* Mobile Layout */}
        <div className="sm:hidden">
          <div className="flex items-center justify-between">
            {/* Left: Status indicator and project name */}
            <div className="flex items-center space-x-2 min-w-0">
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isConnected ? 'bg-green-500' : (isConnecting ? 'bg-yellow-500' : 'bg-red-500')}`} />
              <span className="text-xs text-gray-400 truncate">
                {selectedProject.displayName}
              </span>
              {shellStatus.exists && (
                <svg className="w-3 h-3 text-purple-400 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24" title="Shell激活">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
              )}
            </div>
            {/* Right: Compact button group */}
            <div className="flex items-center space-x-1">
              <button
                onClick={toggleFullscreen}
                className="p-1 text-gray-400 hover:text-white"
                title={isFullscreen ? "退出全屏" : "全屏"}
              >
                {isFullscreen ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M15 9v-4.5M15 9h4.5M15 9l5.25-5.25M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 15v4.5M15 15h4.5m0 0l5.25 5.25" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                  </svg>
                )}
              </button>
              {shellStatus.exists && (
                <button
                  onClick={killShellSession}
                  className="p-1 text-purple-400 hover:text-purple-300"
                  title="终止Shell"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              )}
              {isConnected && (
                <button
                  onClick={disconnectFromShell}
                  className="p-1 text-red-400 hover:text-red-300"
                  title="断开"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>
        
        {/* Desktop Layout */}
        <div className="hidden sm:flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : (isConnecting ? 'bg-yellow-500' : 'bg-red-500')}`} />
            {isConnected && (
              <span className="text-xs text-green-300">
                已连接{shellStatus.reconnectedSessionId && ` (${shellStatus.reconnectedSessionId.slice(0, 8)}...)`}
              </span>
            )}
            {isConnecting && <span className="text-xs text-yellow-300">连接中...</span>}
            {!isConnected && !isConnecting && isInitialized && <span className="text-xs text-red-300">未连接</span>}

            <span className="text-xs text-gray-500 font-mono">
              Shell - {selectedProject.displayName}
            </span>
            {!isInitialized && (
              <span className="text-xs text-yellow-400">(初始化中...)</span>
            )}

            {/* Shell Session Status */}
            {shellStatus.exists && (
              <span className="text-xs text-purple-400 flex items-center space-x-1" title={`Shell会话运行中 (进程ID: ${shellStatus.processId})`}>
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
                <span>Shell激活</span>
                {!shellStatus.isConnected && <span className="text-orange-300">(后台)</span>}
              </span>
            )}
          </div>
          <div className="flex items-center space-x-3">
            {/* Fullscreen Toggle Button */}
            <button
              onClick={toggleFullscreen}
              className="text-xs text-gray-400 hover:text-white flex items-center space-x-1"
              title={isFullscreen ? "退出全屏" : "进入全屏"}
            >
              {isFullscreen ? (
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M15 9v-4.5M15 9h4.5M15 9l5.25-5.25M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 15v4.5M15 15h4.5m0 0l5.25 5.25" />
                </svg>
              ) : (
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                </svg>
              )}
              <span>{isFullscreen ? '退出全屏' : '全屏'}</span>
            </button>

            {/* Kill Remote Shell Button */}
            {shellStatus.exists && (
              <button
                onClick={killShellSession}
                className="px-3 py-1 text-xs bg-purple-600 text-white rounded hover:bg-purple-700 flex items-center space-x-1"
                title="终止远程Shell进程"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                <span>终止远程Shell</span>
              </button>
            )}

            {isConnected && (
              <button
                onClick={disconnectFromShell}
                className="px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 flex items-center space-x-1"
                title="断开Shell连接"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                <span>断开连接</span>
              </button>
            )}

          </div>
        </div>
      </div>

      {/* Terminal */}
      <div className="flex-1 p-1 sm:p-2 overflow-hidden relative min-h-0">
        <div
          ref={terminalRef}
          className="h-full w-full focus:outline-none"
          style={{
            outline: 'none',
            overflow: 'hidden' // Let xterm handle its own scrolling
          }}
          tabIndex={0} // Make focusable for keyboard events
        />
        
        {/* Mobile input helper - invisible input for better mobile keyboard support */}
        {/Mobi|Android/i.test(navigator.userAgent) && (
          <input
            type="text"
            className="absolute opacity-0 -z-10"
            style={{
              position: 'fixed',
              left: '-9999px',
              top: '0',
              width: '1px',
              height: '1px',
              fontSize: '16px', // Prevent zoom on iOS
              pointerEvents: 'none'
            }}
            aria-hidden="true"
            tabIndex={-1}
            onFocus={(e) => {
              // Immediately blur this input and focus terminal
              e.target.blur();
              if (terminal.current) {
                terminal.current.focus();
              }
            }}
          />
        )}

        {/* Loading state */}
        {!isInitialized && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900 bg-opacity-90">
            <div className="text-white">加载终端中...</div>
          </div>
        )}

        {/* Connect buttons when not connected or when remote session was terminated */}
        {isInitialized && !isConnected && !isConnecting && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900 bg-opacity-90 p-4">
            <div className="text-center max-w-md w-full">
              <p className="text-gray-400 text-sm mb-4">
                连接到 {selectedProject.displayName} 终端
              </p>

              {/* Claude Shell Section */}
              <div className="mb-4">
                <button
                  onClick={connectToShell}
                  className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center justify-center space-x-2 text-base font-medium w-full"
                  title="连接到Claude Shell"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  <span>Claude Shell</span>
                </button>

                {/* Claude Shell Status - only show for Claude Shell */}
                {shellStatus.exists && !remoteSessionTerminated && (
                  <div className="mt-2 p-2 bg-green-900/20 border border-green-500/30 rounded text-xs text-green-300">
                    <div className="flex items-center space-x-1 mb-1">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      <span>Claude Shell会话已激活</span>
                    </div>
                    <div>后台运行中 (进程ID: {shellStatus.processId})</div>
                    <div>创建时间: {new Date(shellStatus.createdAt).toLocaleString()}</div>
                    <div className="text-green-400 font-medium">点击上方按钮将重新连接到现有Claude Shell会话</div>
                  </div>
                )}
                
                {/* Show termination message when remote session was terminated */}
                {remoteSessionTerminated && (
                  <div className="mt-2 p-2 bg-orange-900/20 border border-orange-500/30 rounded text-xs text-orange-300">
                    <div className="flex items-center space-x-1 mb-1">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                      </svg>
                      <span>远程Shell会话已终止</span>
                    </div>
                    <div>会话已被用户手动终止</div>
                    <div className="text-orange-400 font-medium">点击上方按钮启动新的Shell会话</div>
                  </div>
                )}
              </div>

              {/* Plain Shell Section */}
              <div>
                <button
                  onClick={connectToPlainShell}
                  className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center space-x-2 text-base font-medium w-full"
                  title="连接到普通Shell"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                  <span>普通Shell</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Connecting state */}
        {isConnecting && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900 bg-opacity-90 p-4">
            <div className="text-center max-w-sm w-full">
              <div className="flex items-center justify-center space-x-3 text-yellow-400">
                <div className="w-6 h-6 animate-spin rounded-full border-2 border-yellow-400 border-t-transparent"></div>
                <span className="text-base font-medium">连接终端中...</span>
              </div>
              <p className="text-gray-400 text-sm mt-3 px-2">
                正在启动 {selectedProject.displayName} 终端
              </p>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

export default Shell;