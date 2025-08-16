/*
 * ChatInterface.jsx - Chat Component with Session Protection Integration
 * 
 * SESSION PROTECTION INTEGRATION:
 * ===============================
 * 
 * This component integrates with the Session Protection System to prevent project updates
 * from interrupting active conversations:
 * 
 * Key Integration Points:
 * 1. handleSubmit() - Marks session as active when user sends message (including temp ID for new sessions)
 * 2. session-created handler - Replaces temporary session ID with real WebSocket session ID  
 * 3. claude-complete handler - Marks session as inactive when conversation finishes
 * 4. session-aborted handler - Marks session as inactive when conversation is aborted
 * 
 * This ensures uninterrupted chat experience by coordinating with App.jsx to pause sidebar updates.
 */

import React, { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';
import { useDropzone } from 'react-dropzone';
import TodoList from './TodoList';
import ClaudeLogo from './ClaudeLogo.jsx';
import CursorLogo from './CursorLogo.jsx';
import ClaudeStatus from './ClaudeStatus';
import { MicButton } from './MicButton.jsx';
import { api, authenticatedFetch } from '../utils/api';

// 导入拆分的组件和工具函数
import { MessageComponent } from './MessageComponent.jsx';
import { ImageAttachment } from './ImageAttachment.jsx';
import { formatUsageLimitText, safeLocalStorage, calculateDiff, flattenFileTree, convertSessionMessages } from '../utils/chatUtils.js';

// Memoized message component to prevent unnecessary re-renders
function ChatInterface({ selectedProject, selectedSession, ws, sendMessage, messages, onFileOpen, onInputFocusChange, onSessionActive, onSessionInactive, onReplaceTemporarySession, onNavigateToSession, onShowSettings, autoExpandTools, showRawParameters, autoScrollToBottom, sendByCtrlEnter }) {
  const [input, setInput] = useState(() => {
    if (typeof window !== 'undefined' && selectedProject) {
      return safeLocalStorage.getItem(`draft_input_${selectedProject.name}`) || '';
    }
    return '';
  });
  const [chatMessages, setChatMessages] = useState(() => {
    if (typeof window !== 'undefined' && selectedProject) {
      const saved = safeLocalStorage.getItem(`chat_messages_${selectedProject.name}`);
      return saved ? JSON.parse(saved) : [];
    }
    return [];
  });
  const [isLoading, setIsLoading] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState(selectedSession?.id || null);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [sessionMessages, setSessionMessages] = useState([]);
  const [isLoadingSessionMessages, setIsLoadingSessionMessages] = useState(false);
  const [isLoadingMoreMessages, setIsLoadingMoreMessages] = useState(false);
  const [messagesOffset, setMessagesOffset] = useState(0);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [totalMessages, setTotalMessages] = useState(0);
  const MESSAGES_PER_PAGE = 20;
  const [isSystemSessionChange, setIsSystemSessionChange] = useState(false);
  const [permissionMode, setPermissionMode] = useState('default');
  const [attachedImages, setAttachedImages] = useState([]);
  const [uploadingImages, setUploadingImages] = useState(new Map());
  const [imageErrors, setImageErrors] = useState(new Map());
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const scrollContainerRef = useRef(null);
  // Streaming throttle buffers
  const streamBufferRef = useRef('');
  const streamTimerRef = useRef(null);
  const [debouncedInput, setDebouncedInput] = useState('');
  const [showFileDropdown, setShowFileDropdown] = useState(false);
  const [fileList, setFileList] = useState([]);
  const [filteredFiles, setFilteredFiles] = useState([]);
  const [selectedFileIndex, setSelectedFileIndex] = useState(-1);
  const [cursorPosition, setCursorPosition] = useState(0);
  const [atSymbolPosition, setAtSymbolPosition] = useState(-1);
  const [canAbortSession, setCanAbortSession] = useState(false);
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  const scrollPositionRef = useRef({ height: 0, top: 0 });
  const [showCommandMenu, setShowCommandMenu] = useState(false);
  const [slashCommands, setSlashCommands] = useState([]);
  const [filteredCommands, setFilteredCommands] = useState([]);
  const [isTextareaExpanded, setIsTextareaExpanded] = useState(false);
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(-1);
  const [slashPosition, setSlashPosition] = useState(-1);
  const [visibleMessageCount, setVisibleMessageCount] = useState(100);
  const [claudeStatus, setClaudeStatus] = useState(null);
  const [provider, setProvider] = useState(() => {
    return localStorage.getItem('selected-provider') || 'claude';
  });
  const [cursorModel, setCursorModel] = useState(() => {
    return localStorage.getItem('cursor-model') || 'gpt-5';
  });
  // When selecting a session from Sidebar, auto-switch provider to match session's origin
  useEffect(() => {
    if (selectedSession && selectedSession.__provider && selectedSession.__provider !== provider) {
      setProvider(selectedSession.__provider);
      localStorage.setItem('selected-provider', selectedSession.__provider);
    }
  }, [selectedSession]);

  // Load Cursor default model from config
  useEffect(() => {
    if (provider === 'cursor') {
      fetch('/api/cursor/config', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth-token')}`
        }
      })
        .then(res => res.json())
        .then(data => {
          if (data.success && data.config?.model?.modelId) {
            // Map Cursor model IDs to our simplified names
            const modelMap = {
              'gpt-5': 'gpt-5',
              'claude-4-sonnet': 'sonnet-4',
              'sonnet-4': 'sonnet-4',
              'claude-4-opus': 'opus-4.1',
              'opus-4.1': 'opus-4.1'
            };
            const mappedModel = modelMap[data.config.model.modelId] || data.config.model.modelId;
            if (!localStorage.getItem('cursor-model')) {
              setCursorModel(mappedModel);
            }
          }
        })
        .catch(err => console.error('Error loading Cursor config:', err));
    }
  }, [provider]);


  // Memoized diff calculation to prevent recalculating on every render
  const createDiff = useMemo(() => {
    const cache = new Map();
    return (oldStr, newStr) => {
      const key = `${oldStr.length}-${newStr.length}-${oldStr.slice(0, 50)}`;
      if (cache.has(key)) {
        return cache.get(key);
      }

      const result = calculateDiff(oldStr, newStr);
      cache.set(key, result);
      if (cache.size > 100) {
        const firstKey = cache.keys().next().value;
        cache.delete(firstKey);
      }
      return result;
    };
  }, []);

  // Load session messages from API with pagination
  const loadSessionMessages = useCallback(async (projectName, sessionId, loadMore = false) => {
    if (!projectName || !sessionId) return [];

    const isInitialLoad = !loadMore;
    if (isInitialLoad) {
      setIsLoadingSessionMessages(true);
    } else {
      setIsLoadingMoreMessages(true);
    }

    try {
      const currentOffset = loadMore ? messagesOffset : 0;
      const response = await api.sessionMessages(projectName, sessionId, MESSAGES_PER_PAGE, currentOffset);
      if (!response.ok) {
        throw new Error('Failed to load session messages');
      }
      const data = await response.json();

      // Handle paginated response
      if (data.hasMore !== undefined) {
        setHasMoreMessages(data.hasMore);
        setTotalMessages(data.total);
        setMessagesOffset(currentOffset + (data.messages?.length || 0));
        return data.messages || [];
      } else {
        // Backward compatibility for non-paginated response
        const messages = data.messages || [];
        setHasMoreMessages(false);
        setTotalMessages(messages.length);
        return messages;
      }
    } catch (error) {
      console.error('Error loading session messages:', error);
      return [];
    } finally {
      if (isInitialLoad) {
        setIsLoadingSessionMessages(false);
      } else {
        setIsLoadingMoreMessages(false);
      }
    }
  }, [messagesOffset]);

  // Load Cursor session messages from SQLite via backend
  const loadCursorSessionMessages = useCallback(async (projectPath, sessionId) => {
    if (!projectPath || !sessionId) return [];
    setIsLoadingSessionMessages(true);
    try {
      const url = `/api/cursor/sessions/${encodeURIComponent(sessionId)}?projectPath=${encodeURIComponent(projectPath)}`;
      const res = await authenticatedFetch(url);
      if (!res.ok) return [];
      const data = await res.json();
      const blobs = data?.session?.messages || [];
      const converted = [];
      const toolUseMap = {}; // Map to store tool uses by ID for linking results

      // First pass: process all messages maintaining order
      for (let blobIdx = 0; blobIdx < blobs.length; blobIdx++) {
        const blob = blobs[blobIdx];
        const content = blob.content;
        let text = '';
        let role = 'assistant';
        let reasoningText = null; // Move to outer scope
        try {
          // Handle different Cursor message formats
          if (content?.role && content?.content) {
            // Direct format: {"role":"user","content":[{"type":"text","text":"..."}]}
            // Skip system messages
            if (content.role === 'system') {
              continue;
            }

            // Handle tool messages
            if (content.role === 'tool') {
              // Tool result format - find the matching tool use message and update it
              if (Array.isArray(content.content)) {
                for (const item of content.content) {
                  if (item?.type === 'tool-result') {
                    // Map ApplyPatch to Edit for consistency
                    let toolName = item.toolName || 'Unknown Tool';
                    if (toolName === 'ApplyPatch') {
                      toolName = 'Edit';
                    }
                    const toolCallId = item.toolCallId || content.id;
                    const result = item.result || '';

                    // Store the tool result to be linked later
                    if (toolUseMap[toolCallId]) {
                      toolUseMap[toolCallId].toolResult = {
                        content: result,
                        isError: false
                      };
                    } else {
                      // No matching tool use found, create a standalone result message
                      converted.push({
                        type: 'assistant',
                        content: '',
                        timestamp: new Date(Date.now() + blobIdx * 1000),
                        blobId: blob.id,
                        sequence: blob.sequence,
                        rowid: blob.rowid,
                        isToolUse: true,
                        toolName: toolName,
                        toolId: toolCallId,
                        toolInput: null,
                        toolResult: {
                          content: result,
                          isError: false
                        }
                      });
                    }
                  }
                }
              }
              continue; // Don't add tool messages as regular messages
            } else {
              // User or assistant messages
              role = content.role === 'user' ? 'user' : 'assistant';

              if (Array.isArray(content.content)) {
                // Extract text, reasoning, and tool calls from content array
                const textParts = [];

                for (const part of content.content) {
                  if (part?.type === 'text' && part?.text) {
                    textParts.push(part.text);
                  } else if (part?.type === 'reasoning' && part?.text) {
                    // Handle reasoning type - will be displayed in a collapsible section
                    reasoningText = part.text;
                  } else if (part?.type === 'tool-call') {
                    // First, add any text/reasoning we've collected so far as a message
                    if (textParts.length > 0 || reasoningText) {
                      converted.push({
                        type: role,
                        content: textParts.join('\n'),
                        reasoning: reasoningText,
                        timestamp: new Date(Date.now() + blobIdx * 1000),
                        blobId: blob.id,
                        sequence: blob.sequence,
                        rowid: blob.rowid
                      });
                      textParts.length = 0;
                      reasoningText = null;
                    }

                    // Tool call in assistant message - format like Claude Code
                    // Map ApplyPatch to Edit for consistency with Claude Code
                    let toolName = part.toolName || 'Unknown Tool';
                    if (toolName === 'ApplyPatch') {
                      toolName = 'Edit';
                    }
                    const toolId = part.toolCallId || `tool_${blobIdx}`;

                    // Create a tool use message with Claude Code format
                    // Map Cursor args format to Claude Code format
                    let toolInput = part.args;

                    if (toolName === 'Edit' && part.args) {
                      // ApplyPatch uses 'patch' format, convert to Edit format
                      if (part.args.patch) {
                        // Parse the patch to extract old and new content
                        const patchLines = part.args.patch.split('\n');
                        let oldLines = [];
                        let newLines = [];
                        let inPatch = false;

                        for (const line of patchLines) {
                          if (line.startsWith('@@')) {
                            inPatch = true;
                          } else if (inPatch) {
                            if (line.startsWith('-')) {
                              oldLines.push(line.substring(1));
                            } else if (line.startsWith('+')) {
                              newLines.push(line.substring(1));
                            } else if (line.startsWith(' ')) {
                              // Context line - add to both
                              oldLines.push(line.substring(1));
                              newLines.push(line.substring(1));
                            }
                          }
                        }

                        const filePath = part.args.file_path;
                        const absolutePath = filePath && !filePath.startsWith('/')
                          ? `${projectPath}/${filePath}`
                          : filePath;
                        toolInput = {
                          file_path: absolutePath,
                          old_string: oldLines.join('\n') || part.args.patch,
                          new_string: newLines.join('\n') || part.args.patch
                        };
                      } else {
                        // Direct edit format
                        toolInput = part.args;
                      }
                    } else if (toolName === 'Read' && part.args) {
                      // Map 'path' to 'file_path'
                      // Convert relative path to absolute if needed
                      const filePath = part.args.path || part.args.file_path;
                      const absolutePath = filePath && !filePath.startsWith('/')
                        ? `${projectPath}/${filePath}`
                        : filePath;
                      toolInput = {
                        file_path: absolutePath
                      };
                    } else if (toolName === 'Write' && part.args) {
                      // Map fields for Write tool
                      const filePath = part.args.path || part.args.file_path;
                      const absolutePath = filePath && !filePath.startsWith('/')
                        ? `${projectPath}/${filePath}`
                        : filePath;
                      toolInput = {
                        file_path: absolutePath,
                        content: part.args.contents || part.args.content
                      };
                    }

                    const toolMessage = {
                      type: 'assistant',
                      content: '',
                      timestamp: new Date(Date.now() + blobIdx * 1000),
                      blobId: blob.id,
                      sequence: blob.sequence,
                      rowid: blob.rowid,
                      isToolUse: true,
                      toolName: toolName,
                      toolId: toolId,
                      toolInput: toolInput ? JSON.stringify(toolInput) : null,
                      toolResult: null // Will be filled when we get the tool result
                    };
                    converted.push(toolMessage);
                    toolUseMap[toolId] = toolMessage; // Store for linking results
                  } else if (part?.type === 'tool_use') {
                    // Old format support
                    if (textParts.length > 0 || reasoningText) {
                      converted.push({
                        type: role,
                        content: textParts.join('\n'),
                        reasoning: reasoningText,
                        timestamp: new Date(Date.now() + blobIdx * 1000),
                        blobId: blob.id,
                        sequence: blob.sequence,
                        rowid: blob.rowid
                      });
                      textParts.length = 0;
                      reasoningText = null;
                    }

                    const toolName = part.name || 'Unknown Tool';
                    const toolId = part.id || `tool_${blobIdx}`;

                    const toolMessage = {
                      type: 'assistant',
                      content: '',
                      timestamp: new Date(Date.now() + blobIdx * 1000),
                      blobId: blob.id,
                      sequence: blob.sequence,
                      rowid: blob.rowid,
                      isToolUse: true,
                      toolName: toolName,
                      toolId: toolId,
                      toolInput: part.input ? JSON.stringify(part.input) : null,
                      toolResult: null
                    };
                    converted.push(toolMessage);
                    toolUseMap[toolId] = toolMessage;
                  } else if (typeof part === 'string') {
                    textParts.push(part);
                  }
                }

                // Add any remaining text/reasoning
                if (textParts.length > 0) {
                  text = textParts.join('\n');
                  if (reasoningText && !text) {
                    // Just reasoning, no text
                    converted.push({
                      type: role,
                      content: '',
                      reasoning: reasoningText,
                      timestamp: new Date(Date.now() + blobIdx * 1000),
                      blobId: blob.id,
                      sequence: blob.sequence,
                      rowid: blob.rowid
                    });
                    text = ''; // Clear to avoid duplicate
                  }
                } else {
                  text = '';
                }
              } else if (typeof content.content === 'string') {
                text = content.content;
              }
            }
          } else if (content?.message?.role && content?.message?.content) {
            // Nested message format
            if (content.message.role === 'system') {
              continue;
            }
            role = content.message.role === 'user' ? 'user' : 'assistant';
            if (Array.isArray(content.message.content)) {
              text = content.message.content
                .map(p => (typeof p === 'string' ? p : (p?.text || '')))
                .filter(Boolean)
                .join('\n');
            } else if (typeof content.message.content === 'string') {
              text = content.message.content;
            }
          }
        } catch (e) {
          console.log('Error parsing blob content:', e);
        }
        if (text && text.trim()) {
          const message = {
            type: role,
            content: text,
            timestamp: new Date(Date.now() + blobIdx * 1000),
            blobId: blob.id,
            sequence: blob.sequence,
            rowid: blob.rowid
          };

          // Add reasoning if we have it
          if (reasoningText) {
            message.reasoning = reasoningText;
          }

          converted.push(message);
        }
      }

      // Sort messages by sequence/rowid to maintain chronological order
      converted.sort((a, b) => {
        // First sort by sequence if available (clean 1,2,3... numbering)
        if (a.sequence !== undefined && b.sequence !== undefined) {
          return a.sequence - b.sequence;
        }
        // Then try rowid (original SQLite row IDs)
        if (a.rowid !== undefined && b.rowid !== undefined) {
          return a.rowid - b.rowid;
        }
        // Fallback to timestamp
        return new Date(a.timestamp) - new Date(b.timestamp);
      });

      return converted;
    } catch (e) {
      console.error('Error loading Cursor session messages:', e);
      return [];
    } finally {
      setIsLoadingSessionMessages(false);
    }
  }, []);




  // Memoize expensive convertSessionMessages operation
  const convertedMessages = useMemo(() => {
    return convertSessionMessages(sessionMessages);
  }, [sessionMessages]);

  // Define scroll functions early to avoid hoisting issues in useEffect dependencies
  const scrollToBottom = useCallback(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
      setIsUserScrolledUp(false);
    }
  }, []);

  // Check if user is near the bottom of the scroll container
  const isNearBottom = useCallback(() => {
    if (!scrollContainerRef.current) return false;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    // Consider "near bottom" if within 50px of the bottom
    return scrollHeight - scrollTop - clientHeight < 50;
  }, []);

  // Handle scroll events to detect when user manually scrolls up and load more messages
  const handleScroll = useCallback(async () => {
    if (scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const nearBottom = isNearBottom();
      setIsUserScrolledUp(!nearBottom);

      // Check if we should load more messages (scrolled near top)
      const scrolledNearTop = container.scrollTop < 100;
      const provider = localStorage.getItem('selected-provider') || 'claude';

      if (scrolledNearTop && hasMoreMessages && !isLoadingMoreMessages && selectedSession && selectedProject && provider !== 'cursor') {
        // Save current scroll position
        const previousScrollHeight = container.scrollHeight;
        const previousScrollTop = container.scrollTop;

        // Load more messages
        const moreMessages = await loadSessionMessages(selectedProject.name, selectedSession.id, true);

        if (moreMessages.length > 0) {
          // Prepend new messages to the existing ones
          setSessionMessages(prev => [...moreMessages, ...prev]);

          // Restore scroll position after DOM update
          setTimeout(() => {
            if (scrollContainerRef.current) {
              const newScrollHeight = scrollContainerRef.current.scrollHeight;
              const scrollDiff = newScrollHeight - previousScrollHeight;
              scrollContainerRef.current.scrollTop = previousScrollTop + scrollDiff;
            }
          }, 0);
        }
      }
    }
  }, [isNearBottom, hasMoreMessages, isLoadingMoreMessages, selectedSession, selectedProject, loadSessionMessages]);

  useEffect(() => {
    // Load session messages when session changes
    const loadMessages = async () => {
      if (selectedSession && selectedProject) {
        const provider = localStorage.getItem('selected-provider') || 'claude';

        // Reset pagination state when switching sessions
        setMessagesOffset(0);
        setHasMoreMessages(false);
        setTotalMessages(0);

        if (provider === 'cursor') {
          // For Cursor, set the session ID for resuming
          setCurrentSessionId(selectedSession.id);
          sessionStorage.setItem('cursorSessionId', selectedSession.id);

          // Only load messages from SQLite if this is NOT a system-initiated session change
          // For system-initiated changes, preserve existing messages
          if (!isSystemSessionChange) {
            // Load historical messages for Cursor session from SQLite
            const projectPath = selectedProject.fullPath || selectedProject.path;
            const converted = await loadCursorSessionMessages(projectPath, selectedSession.id);
            setSessionMessages([]);
            setChatMessages(converted);
          } else {
            // Reset the flag after handling system session change
            setIsSystemSessionChange(false);
          }
        } else {
          // For Claude, load messages normally with pagination
          setCurrentSessionId(selectedSession.id);

          // Only load messages from API if this is a user-initiated session change
          // For system-initiated changes, preserve existing messages and rely on WebSocket
          if (!isSystemSessionChange) {
            const messages = await loadSessionMessages(selectedProject.name, selectedSession.id, false);
            setSessionMessages(messages);
            // convertedMessages will be automatically updated via useMemo
            // Scroll to bottom after loading session messages if auto-scroll is enabled
            if (autoScrollToBottom) {
              setTimeout(() => scrollToBottom(), 200);
            }
          } else {
            // Reset the flag after handling system session change
            setIsSystemSessionChange(false);
          }
        }
      } else {
        // Only clear messages if this is NOT a system-initiated session change AND we're not loading
        // During system session changes or while loading, preserve the chat messages
        if (!isSystemSessionChange && !isLoading) {
          setChatMessages([]);
          setSessionMessages([]);
        }
        setCurrentSessionId(null);
        sessionStorage.removeItem('cursorSessionId');
        setMessagesOffset(0);
        setHasMoreMessages(false);
        setTotalMessages(0);
      }
    };

    loadMessages();
  }, [selectedSession, selectedProject, loadCursorSessionMessages, scrollToBottom, isSystemSessionChange]);

  // Update chatMessages when convertedMessages changes
  useEffect(() => {
    if (sessionMessages.length > 0) {
      setChatMessages(convertedMessages);
    }
  }, [convertedMessages, sessionMessages]);

  // Notify parent when input focus changes
  useEffect(() => {
    if (onInputFocusChange) {
      onInputFocusChange(isInputFocused);
    }
  }, [isInputFocused, onInputFocusChange]);

  // Persist input draft to localStorage
  useEffect(() => {
    if (selectedProject && input !== '') {
      safeLocalStorage.setItem(`draft_input_${selectedProject.name}`, input);
    } else if (selectedProject && input === '') {
      safeLocalStorage.removeItem(`draft_input_${selectedProject.name}`);
    }
  }, [input, selectedProject]);

  // Persist chat messages to localStorage
  useEffect(() => {
    if (selectedProject && chatMessages.length > 0) {
      safeLocalStorage.setItem(`chat_messages_${selectedProject.name}`, JSON.stringify(chatMessages));
    }
  }, [chatMessages, selectedProject]);

  // Load saved state when project changes (but don't interfere with session loading)
  useEffect(() => {
    if (selectedProject) {
      // Always load saved input draft for the project
      const savedInput = safeLocalStorage.getItem(`draft_input_${selectedProject.name}`) || '';
      if (savedInput !== input) {
        setInput(savedInput);
      }
    }
  }, [selectedProject?.name]);


  useEffect(() => {
    // Handle WebSocket messages
    if (messages.length > 0) {
      const latestMessage = messages[messages.length - 1];

      switch (latestMessage.type) {
        case 'session-created':
          // New session created by Claude CLI - we receive the real session ID here
          // Store it temporarily until conversation completes (prevents premature session association)
          if (latestMessage.sessionId && !currentSessionId) {
            sessionStorage.setItem('pendingSessionId', latestMessage.sessionId);

            // Session Protection: Replace temporary "new-session-*" identifier with real session ID
            // This maintains protection continuity - no gap between temp ID and real ID
            // The temporary session is removed and real session is marked as active
            if (onReplaceTemporarySession) {
              onReplaceTemporarySession(latestMessage.sessionId);
            }
          }
          break;

        case 'claude-response':
          const messageData = latestMessage.data.message || latestMessage.data;

          // Handle Cursor streaming format (content_block_delta / content_block_stop)
          if (messageData && typeof messageData === 'object' && messageData.type) {
            if (messageData.type === 'content_block_delta' && messageData.delta?.text) {
              // Buffer deltas and flush periodically to reduce rerenders
              streamBufferRef.current += messageData.delta.text;
              if (!streamTimerRef.current) {
                streamTimerRef.current = setTimeout(() => {
                  const chunk = streamBufferRef.current;
                  streamBufferRef.current = '';
                  streamTimerRef.current = null;
                  if (!chunk) return;
                  setChatMessages(prev => {
                    const updated = [...prev];
                    const last = updated[updated.length - 1];
                    if (last && last.type === 'assistant' && !last.isToolUse && last.isStreaming) {
                      last.content = (last.content || '') + chunk;
                    } else {
                      updated.push({ type: 'assistant', content: chunk, timestamp: new Date(), isStreaming: true });
                    }
                    return updated;
                  });
                }, 100);
              }
              return;
            }
            if (messageData.type === 'content_block_stop') {
              // Flush any buffered text and mark streaming message complete
              if (streamTimerRef.current) {
                clearTimeout(streamTimerRef.current);
                streamTimerRef.current = null;
              }
              const chunk = streamBufferRef.current;
              streamBufferRef.current = '';
              if (chunk) {
                setChatMessages(prev => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last && last.type === 'assistant' && !last.isToolUse && last.isStreaming) {
                    last.content = (last.content || '') + chunk;
                  } else {
                    updated.push({ type: 'assistant', content: chunk, timestamp: new Date(), isStreaming: true });
                  }
                  return updated;
                });
              }
              setChatMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last && last.type === 'assistant' && last.isStreaming) {
                  last.isStreaming = false;
                }
                return updated;
              });
              return;
            }
          }

          // Handle Claude CLI session duplication bug workaround:
          // When resuming a session, Claude CLI creates a new session instead of resuming.
          // We detect this by checking for system/init messages with session_id that differs
          // from our current session. When found, we need to switch the user to the new session.
          if (latestMessage.data.type === 'system' &&
            latestMessage.data.subtype === 'init' &&
            latestMessage.data.session_id &&
            currentSessionId &&
            latestMessage.data.session_id !== currentSessionId) {

            console.log('🔄 Claude CLI session duplication detected:', {
              originalSession: currentSessionId,
              newSession: latestMessage.data.session_id
            });

            // Mark this as a system-initiated session change to preserve messages
            setIsSystemSessionChange(true);

            // Switch to the new session using React Router navigation
            // This triggers the session loading logic in App.jsx without a page reload
            if (onNavigateToSession) {
              onNavigateToSession(latestMessage.data.session_id);
            }
            return; // Don't process the message further, let the navigation handle it
          }

          // Handle system/init for new sessions (when currentSessionId is null)
          if (latestMessage.data.type === 'system' &&
            latestMessage.data.subtype === 'init' &&
            latestMessage.data.session_id &&
            !currentSessionId) {

            console.log('🔄 New session init detected:', {
              newSession: latestMessage.data.session_id
            });

            // Mark this as a system-initiated session change to preserve messages
            setIsSystemSessionChange(true);

            // Switch to the new session
            if (onNavigateToSession) {
              onNavigateToSession(latestMessage.data.session_id);
            }
            return; // Don't process the message further, let the navigation handle it
          }

          // For system/init messages that match current session, just ignore them
          if (latestMessage.data.type === 'system' &&
            latestMessage.data.subtype === 'init' &&
            latestMessage.data.session_id &&
            currentSessionId &&
            latestMessage.data.session_id === currentSessionId) {
            console.log('🔄 System init message for current session, ignoring');
            return; // Don't process the message further
          }

          // Handle different types of content in the response
          if (Array.isArray(messageData.content)) {
            for (const part of messageData.content) {
              if (part.type === 'tool_use') {
                // Add tool use message
                const toolInput = part.input ? JSON.stringify(part.input, null, 2) : '';
                setChatMessages(prev => [...prev, {
                  type: 'assistant',
                  content: '',
                  timestamp: new Date(),
                  isToolUse: true,
                  toolName: part.name,
                  toolInput: toolInput,
                  toolId: part.id,
                  toolResult: null // Will be updated when result comes in
                }]);
              } else if (part.type === 'text' && part.text?.trim()) {
                // Normalize usage limit message to local time
                let content = formatUsageLimitText(part.text);

                // Add regular text message
                setChatMessages(prev => [...prev, {
                  type: 'assistant',
                  content: content,
                  timestamp: new Date()
                }]);
              }
            }
          } else if (typeof messageData.content === 'string' && messageData.content.trim()) {
            // Normalize usage limit message to local time
            let content = formatUsageLimitText(messageData.content);

            // Add regular text message
            setChatMessages(prev => [...prev, {
              type: 'assistant',
              content: content,
              timestamp: new Date()
            }]);
          }

          // Handle tool results from user messages (these come separately)
          if (messageData.role === 'user' && Array.isArray(messageData.content)) {
            for (const part of messageData.content) {
              if (part.type === 'tool_result') {
                // Find the corresponding tool use and update it with the result
                setChatMessages(prev => prev.map(msg => {
                  if (msg.isToolUse && msg.toolId === part.tool_use_id) {
                    return {
                      ...msg,
                      toolResult: {
                        content: part.content,
                        isError: part.is_error,
                        timestamp: new Date()
                      }
                    };
                  }
                  return msg;
                }));
              }
            }
          }
          break;

        case 'claude-output':
          {
            const cleaned = String(latestMessage.data || '');
            if (cleaned.trim()) {
              streamBufferRef.current += (streamBufferRef.current ? `\n${cleaned}` : cleaned);
              if (!streamTimerRef.current) {
                streamTimerRef.current = setTimeout(() => {
                  const chunk = streamBufferRef.current;
                  streamBufferRef.current = '';
                  streamTimerRef.current = null;
                  if (!chunk) return;
                  setChatMessages(prev => {
                    const updated = [...prev];
                    const last = updated[updated.length - 1];
                    if (last && last.type === 'assistant' && !last.isToolUse && last.isStreaming) {
                      last.content = last.content ? `${last.content}\n${chunk}` : chunk;
                    } else {
                      updated.push({ type: 'assistant', content: chunk, timestamp: new Date(), isStreaming: true });
                    }
                    return updated;
                  });
                }, 100);
              }
            }
          }
          break;
        case 'claude-interactive-prompt':
          // Handle interactive prompts from CLI
          setChatMessages(prev => [...prev, {
            type: 'assistant',
            content: latestMessage.data,
            timestamp: new Date(),
            isInteractivePrompt: true
          }]);
          break;

        case 'claude-error':
          setChatMessages(prev => [...prev, {
            type: 'error',
            content: `Error: ${latestMessage.error}`,
            timestamp: new Date()
          }]);
          break;

        case 'cursor-system':
          // Handle Cursor system/init messages similar to Claude
          try {
            const cdata = latestMessage.data;
            if (cdata && cdata.type === 'system' && cdata.subtype === 'init' && cdata.session_id) {
              // If we already have a session and this differs, switch (duplication/redirect)
              if (currentSessionId && cdata.session_id !== currentSessionId) {
                console.log('🔄 Cursor session switch detected:', { originalSession: currentSessionId, newSession: cdata.session_id });
                setIsSystemSessionChange(true);
                if (onNavigateToSession) {
                  onNavigateToSession(cdata.session_id);
                }
                return;
              }
              // If we don't yet have a session, adopt this one
              if (!currentSessionId) {
                console.log('🔄 Cursor new session init detected:', { newSession: cdata.session_id });
                setIsSystemSessionChange(true);
                if (onNavigateToSession) {
                  onNavigateToSession(cdata.session_id);
                }
                return;
              }
            }
            // For other cursor-system messages, avoid dumping raw objects to chat
          } catch (e) {
            console.warn('Error handling cursor-system message:', e);
          }
          break;

        case 'cursor-user':
          // Handle Cursor user messages (usually echoes)
          // Don't add user messages as they're already shown from input
          break;

        case 'cursor-tool-use':
          // Handle Cursor tool use messages
          setChatMessages(prev => [...prev, {
            type: 'assistant',
            content: `Using tool: ${latestMessage.tool} ${latestMessage.input ? `with ${latestMessage.input}` : ''}`,
            timestamp: new Date(),
            isToolUse: true,
            toolName: latestMessage.tool,
            toolInput: latestMessage.input
          }]);
          break;

        case 'cursor-error':
          // Show Cursor errors as error messages in chat
          setChatMessages(prev => [...prev, {
            type: 'error',
            content: `Cursor error: ${latestMessage.error || 'Unknown error'}`,
            timestamp: new Date()
          }]);
          break;

        case 'cursor-result':
          // Handle Cursor completion and final result text
          setIsLoading(false);
          setCanAbortSession(false);
          setClaudeStatus(null);
          try {
            const r = latestMessage.data || {};
            const textResult = typeof r.result === 'string' ? r.result : '';
            // Flush buffered deltas before finalizing
            if (streamTimerRef.current) {
              clearTimeout(streamTimerRef.current);
              streamTimerRef.current = null;
            }
            const pendingChunk = streamBufferRef.current;
            streamBufferRef.current = '';

            setChatMessages(prev => {
              const updated = [...prev];
              // Try to consolidate into the last streaming assistant message
              const last = updated[updated.length - 1];
              if (last && last.type === 'assistant' && !last.isToolUse && last.isStreaming) {
                // Replace streaming content with the final content so deltas don't remain
                const finalContent = textResult && textResult.trim() ? textResult : (last.content || '') + (pendingChunk || '');
                last.content = finalContent;
                last.isStreaming = false;
              } else if (textResult && textResult.trim()) {
                updated.push({ type: r.is_error ? 'error' : 'assistant', content: textResult, timestamp: new Date(), isStreaming: false });
              }
              return updated;
            });
          } catch (e) {
            console.warn('Error handling cursor-result message:', e);
          }

          // Mark session as inactive
          const cursorSessionId = currentSessionId || sessionStorage.getItem('pendingSessionId');
          if (cursorSessionId && onSessionInactive) {
            onSessionInactive(cursorSessionId);
          }

          // Store session ID for future use and trigger refresh
          if (cursorSessionId && !currentSessionId) {
            setCurrentSessionId(cursorSessionId);
            sessionStorage.removeItem('pendingSessionId');

            // Trigger a project refresh to update the sidebar with the new session
            if (window.refreshProjects) {
              setTimeout(() => window.refreshProjects(), 500);
            }
          }
          break;

        case 'cursor-output':
          // Handle Cursor raw terminal output; strip ANSI and ignore empty control-only payloads
          try {
            const raw = String(latestMessage.data ?? '');
            const cleaned = raw.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').trim();
            if (cleaned) {
              streamBufferRef.current += (streamBufferRef.current ? `\n${cleaned}` : cleaned);
              if (!streamTimerRef.current) {
                streamTimerRef.current = setTimeout(() => {
                  const chunk = streamBufferRef.current;
                  streamBufferRef.current = '';
                  streamTimerRef.current = null;
                  if (!chunk) return;
                  setChatMessages(prev => {
                    const updated = [...prev];
                    const last = updated[updated.length - 1];
                    if (last && last.type === 'assistant' && !last.isToolUse && last.isStreaming) {
                      last.content = last.content ? `${last.content}\n${chunk}` : chunk;
                    } else {
                      updated.push({ type: 'assistant', content: chunk, timestamp: new Date(), isStreaming: true });
                    }
                    return updated;
                  });
                }, 100);
              }
            }
          } catch (e) {
            console.warn('Error handling cursor-output message:', e);
          }
          break;

        case 'claude-complete':
          setIsLoading(false);
          setCanAbortSession(false);
          setClaudeStatus(null);


          // Session Protection: Mark session as inactive to re-enable automatic project updates
          // Conversation is complete, safe to allow project updates again
          // Use real session ID if available, otherwise use pending session ID
          const activeSessionId = currentSessionId || sessionStorage.getItem('pendingSessionId');
          if (activeSessionId && onSessionInactive) {
            onSessionInactive(activeSessionId);
          }

          // If we have a pending session ID and the conversation completed successfully, use it
          const pendingSessionId = sessionStorage.getItem('pendingSessionId');
          if (pendingSessionId && !currentSessionId && latestMessage.exitCode === 0) {
            setCurrentSessionId(pendingSessionId);
            sessionStorage.removeItem('pendingSessionId');

            // Trigger a project refresh to update the sidebar with the new session
            if (window.refreshProjects) {
              setTimeout(() => window.refreshProjects(), 500);
            }
          }

          // Clear persisted chat messages after successful completion
          if (selectedProject && latestMessage.exitCode === 0) {
            safeLocalStorage.removeItem(`chat_messages_${selectedProject.name}`);
          }
          break;

        case 'session-aborted':
          setIsLoading(false);
          setCanAbortSession(false);
          setClaudeStatus(null);

          // Session Protection: Mark session as inactive when aborted
          // User or system aborted the conversation, re-enable project updates
          if (currentSessionId && onSessionInactive) {
            onSessionInactive(currentSessionId);
          }

          setChatMessages(prev => [...prev, {
            type: 'assistant',
            content: 'Session interrupted by user.',
            timestamp: new Date()
          }]);
          break;

        case 'claude-status':
          // Handle Claude working status messages
          const statusData = latestMessage.data;
          if (statusData) {
            // Parse the status message to extract relevant information
            let statusInfo = {
              text: 'Working...',
              tokens: 0,
              can_interrupt: true
            };

            // Check for different status message formats
            if (statusData.message) {
              statusInfo.text = statusData.message;
            } else if (statusData.status) {
              statusInfo.text = statusData.status;
            } else if (typeof statusData === 'string') {
              statusInfo.text = statusData;
            }

            // Extract token count
            if (statusData.tokens) {
              statusInfo.tokens = statusData.tokens;
            } else if (statusData.token_count) {
              statusInfo.tokens = statusData.token_count;
            }

            // Check if can interrupt
            if (statusData.can_interrupt !== undefined) {
              statusInfo.can_interrupt = statusData.can_interrupt;
            }

            setClaudeStatus(statusInfo);
            setIsLoading(true);
            setCanAbortSession(statusInfo.can_interrupt);
          }
          break;

      }
    }
  }, [messages]);

  // Load file list when project changes
  useEffect(() => {
    if (selectedProject) {
      fetchProjectFiles();
    }
  }, [selectedProject]);

  const fetchProjectFiles = async () => {
    try {
      const response = await api.getFiles(selectedProject.name);
      if (response.ok) {
        const files = await response.json();
        // Flatten the file tree to get all file paths
        const flatFiles = flattenFileTree(files);
        setFileList(flatFiles);
      }
    } catch (error) {
      console.error('Error fetching files:', error);
    }
  };



  // Handle @ symbol detection and file filtering
  useEffect(() => {
    const textBeforeCursor = input.slice(0, cursorPosition);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');

    if (lastAtIndex !== -1) {
      const textAfterAt = textBeforeCursor.slice(lastAtIndex + 1);
      // Check if there's a space after the @ symbol (which would end the file reference)
      if (!textAfterAt.includes(' ')) {
        setAtSymbolPosition(lastAtIndex);
        setShowFileDropdown(true);

        // Filter files based on the text after @
        const filtered = fileList.filter(file =>
          file.name.toLowerCase().includes(textAfterAt.toLowerCase()) ||
          file.path.toLowerCase().includes(textAfterAt.toLowerCase())
        ).slice(0, 10); // Limit to 10 results

        setFilteredFiles(filtered);
        setSelectedFileIndex(-1);
      } else {
        setShowFileDropdown(false);
        setAtSymbolPosition(-1);
      }
    } else {
      setShowFileDropdown(false);
      setAtSymbolPosition(-1);
    }
  }, [input, cursorPosition, fileList]);

  // Debounced input handling
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedInput(input);
    }, 150); // 150ms debounce

    return () => clearTimeout(timer);
  }, [input]);

  // Show only recent messages for better performance
  const visibleMessages = useMemo(() => {
    if (chatMessages.length <= visibleMessageCount) {
      return chatMessages;
    }
    return chatMessages.slice(-visibleMessageCount);
  }, [chatMessages, visibleMessageCount]);

  // Capture scroll position before render when auto-scroll is disabled
  useEffect(() => {
    if (!autoScrollToBottom && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      scrollPositionRef.current = {
        height: container.scrollHeight,
        top: container.scrollTop
      };
    }
  });

  useEffect(() => {
    // Auto-scroll to bottom when new messages arrive
    if (scrollContainerRef.current && chatMessages.length > 0) {
      if (autoScrollToBottom) {
        // If auto-scroll is enabled, always scroll to bottom unless user has manually scrolled up
        if (!isUserScrolledUp) {
          setTimeout(() => scrollToBottom(), 50); // Small delay to ensure DOM is updated
        }
      } else {
        // When auto-scroll is disabled, preserve the visual position
        const container = scrollContainerRef.current;
        const prevHeight = scrollPositionRef.current.height;
        const prevTop = scrollPositionRef.current.top;
        const newHeight = container.scrollHeight;
        const heightDiff = newHeight - prevHeight;

        // If content was added above the current view, adjust scroll position
        if (heightDiff > 0 && prevTop > 0) {
          container.scrollTop = prevTop + heightDiff;
        }
      }
    }
  }, [chatMessages.length, isUserScrolledUp, scrollToBottom, autoScrollToBottom]);

  // Scroll to bottom when component mounts with existing messages or when messages first load
  useEffect(() => {
    if (scrollContainerRef.current && chatMessages.length > 0) {
      // Always scroll to bottom when messages first load (user expects to see latest)
      // Also reset scroll state
      setIsUserScrolledUp(false);
      setTimeout(() => scrollToBottom(), 200); // Longer delay to ensure full rendering
    }
  }, [chatMessages.length > 0, scrollToBottom]); // Trigger when messages first appear

  // Add scroll event listener to detect user scrolling
  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (scrollContainer) {
      scrollContainer.addEventListener('scroll', handleScroll);
      return () => scrollContainer.removeEventListener('scroll', handleScroll);
    }
  }, [handleScroll]);

  // Initial textarea setup
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';

      // Check if initially expanded
      const lineHeight = parseInt(window.getComputedStyle(textareaRef.current).lineHeight);
      const isExpanded = textareaRef.current.scrollHeight > lineHeight * 2;
      setIsTextareaExpanded(isExpanded);
    }
  }, []); // Only run once on mount

  // Reset textarea height when input is cleared programmatically
  useEffect(() => {
    if (textareaRef.current && !input.trim()) {
      textareaRef.current.style.height = 'auto';
      setIsTextareaExpanded(false);
    }
  }, [input]);

  const handleTranscript = useCallback((text) => {
    if (text.trim()) {
      setInput(prevInput => {
        const newInput = prevInput.trim() ? `${prevInput} ${text}` : text;

        // Update textarea height after setting new content
        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';

            // Check if expanded after transcript
            const lineHeight = parseInt(window.getComputedStyle(textareaRef.current).lineHeight);
            const isExpanded = textareaRef.current.scrollHeight > lineHeight * 2;
            setIsTextareaExpanded(isExpanded);
          }
        }, 0);

        return newInput;
      });
    }
  }, []);

  // Load earlier messages by increasing the visible message count
  const loadEarlierMessages = useCallback(() => {
    setVisibleMessageCount(prevCount => prevCount + 100);
  }, []);

  // Handle image files from drag & drop or file picker
  const handleImageFiles = useCallback((files) => {
    const validFiles = files.filter(file => {
      try {
        // Validate file object and properties
        if (!file || typeof file !== 'object') {
          console.warn('Invalid file object:', file);
          return false;
        }

        if (!file.type || !file.type.startsWith('image/')) {
          return false;
        }

        if (!file.size || file.size > 5 * 1024 * 1024) {
          // Safely get file name with fallback
          const fileName = file.name || 'Unknown file';
          setImageErrors(prev => {
            const newMap = new Map(prev);
            newMap.set(fileName, 'File too large (max 5MB)');
            return newMap;
          });
          return false;
        }

        return true;
      } catch (error) {
        console.error('Error validating file:', error, file);
        return false;
      }
    });

    if (validFiles.length > 0) {
      setAttachedImages(prev => [...prev, ...validFiles].slice(0, 5)); // Max 5 images
    }
  }, []);

  // Handle clipboard paste for images
  const handlePaste = useCallback(async (e) => {
    const items = Array.from(e.clipboardData.items);

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          handleImageFiles([file]);
        }
      }
    }

    // Fallback for some browsers/platforms
    if (items.length === 0 && e.clipboardData.files.length > 0) {
      const files = Array.from(e.clipboardData.files);
      const imageFiles = files.filter(f => f.type.startsWith('image/'));
      if (imageFiles.length > 0) {
        handleImageFiles(imageFiles);
      }
    }
  }, [handleImageFiles]);

  // Setup dropzone
  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    accept: {
      'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']
    },
    maxSize: 5 * 1024 * 1024, // 5MB
    maxFiles: 5,
    onDrop: handleImageFiles,
    noClick: true, // We'll use our own button
    noKeyboard: true
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!input.trim() || isLoading || !selectedProject) return;

    // Upload images first if any
    let uploadedImages = [];
    if (attachedImages.length > 0) {
      const formData = new FormData();
      attachedImages.forEach(file => {
        formData.append('images', file);
      });

      try {
        const token = safeLocalStorage.getItem('auth-token');
        const headers = {};
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }

        const response = await fetch(`/api/projects/${selectedProject.name}/upload-images`, {
          method: 'POST',
          headers: headers,
          body: formData
        });

        if (!response.ok) {
          throw new Error('Failed to upload images');
        }

        const result = await response.json();
        uploadedImages = result.images;
      } catch (error) {
        console.error('Image upload failed:', error);
        setChatMessages(prev => [...prev, {
          type: 'error',
          content: `Failed to upload images: ${error.message}`,
          timestamp: new Date()
        }]);
        return;
      }
    }

    const userMessage = {
      type: 'user',
      content: input,
      images: uploadedImages,
      timestamp: new Date()
    };

    setChatMessages(prev => [...prev, userMessage]);
    setIsLoading(true);
    setCanAbortSession(true);
    // Set a default status when starting
    setClaudeStatus({
      text: 'Processing',
      tokens: 0,
      can_interrupt: true
    });

    // Always scroll to bottom when user sends a message and reset scroll state
    setIsUserScrolledUp(false); // Reset scroll state so auto-scroll works for Claude's response
    setTimeout(() => scrollToBottom(), 100); // Longer delay to ensure message is rendered

    // Determine effective session id for replies to avoid race on state updates
    const effectiveSessionId = currentSessionId || selectedSession?.id || sessionStorage.getItem('cursorSessionId');

    // Session Protection: Mark session as active to prevent automatic project updates during conversation
    // Use existing session if available; otherwise a temporary placeholder until backend provides real ID
    const sessionToActivate = effectiveSessionId || `new-session-${Date.now()}`;
    if (onSessionActive) {
      onSessionActive(sessionToActivate);
    }

    // Get tools settings from localStorage based on provider
    const getToolsSettings = () => {
      try {
        const settingsKey = provider === 'cursor' ? 'cursor-tools-settings' : 'claude-tools-settings';
        const savedSettings = safeLocalStorage.getItem(settingsKey);
        if (savedSettings) {
          return JSON.parse(savedSettings);
        }
      } catch (error) {
        console.error('Error loading tools settings:', error);
      }
      return {
        allowedTools: [],
        disallowedTools: [],
        skipPermissions: false
      };
    };

    const toolsSettings = getToolsSettings();

    // Send command based on provider
    if (provider === 'cursor') {
      // Send Cursor command (always use cursor-command; include resume/sessionId when replying)
      sendMessage({
        type: 'cursor-command',
        command: input,
        sessionId: effectiveSessionId,
        options: {
          // Prefer fullPath (actual cwd for project), fallback to path
          cwd: selectedProject.fullPath || selectedProject.path,
          projectPath: selectedProject.fullPath || selectedProject.path,
          sessionId: effectiveSessionId,
          resume: !!effectiveSessionId,
          model: cursorModel,
          skipPermissions: toolsSettings?.skipPermissions || false,
          toolsSettings: toolsSettings
        }
      });
    } else {
      // Send Claude command (existing code)
      sendMessage({
        type: 'claude-command',
        command: input,
        options: {
          projectPath: selectedProject.path,
          cwd: selectedProject.fullPath,
          sessionId: currentSessionId,
          resume: !!currentSessionId,
          toolsSettings: toolsSettings,
          permissionMode: permissionMode,
          images: uploadedImages // Pass images to backend
        }
      });
    }

    setInput('');
    setAttachedImages([]);
    setUploadingImages(new Map());
    setImageErrors(new Map());
    setIsTextareaExpanded(false);

    // Reset textarea height


    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    // Clear the saved draft since message was sent
    if (selectedProject) {
      safeLocalStorage.removeItem(`draft_input_${selectedProject.name}`);
    }
  };

  const handleKeyDown = (e) => {
    // Handle file dropdown navigation
    if (showFileDropdown && filteredFiles.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedFileIndex(prev =>
          prev < filteredFiles.length - 1 ? prev + 1 : 0
        );
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedFileIndex(prev =>
          prev > 0 ? prev - 1 : filteredFiles.length - 1
        );
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        if (selectedFileIndex >= 0) {
          selectFile(filteredFiles[selectedFileIndex]);
        } else if (filteredFiles.length > 0) {
          selectFile(filteredFiles[0]);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowFileDropdown(false);
        return;
      }
    }

    // Handle Tab key for mode switching (only when file dropdown is not showing)
    if (e.key === 'Tab' && !showFileDropdown) {
      e.preventDefault();
      const modes = ['default', 'acceptEdits', 'bypassPermissions', 'plan'];
      const currentIndex = modes.indexOf(permissionMode);
      const nextIndex = (currentIndex + 1) % modes.length;
      setPermissionMode(modes[nextIndex]);
      return;
    }

    // Handle Enter key: Ctrl+Enter (Cmd+Enter on Mac) sends, Shift+Enter creates new line
    if (e.key === 'Enter') {
      // If we're in composition, don't send message
      if (e.nativeEvent.isComposing) {
        return; // Let IME handle the Enter key
      }

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
        // Ctrl+Enter or Cmd+Enter: Send message
        e.preventDefault();
        handleSubmit(e);
      } else if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
        // Plain Enter: Send message only if not in IME composition
        if (!sendByCtrlEnter) {
          e.preventDefault();
          handleSubmit(e);
        }
      }
      // Shift+Enter: Allow default behavior (new line)
    }
  };

  const selectFile = (file) => {
    const textBeforeAt = input.slice(0, atSymbolPosition);
    const textAfterAtQuery = input.slice(atSymbolPosition);
    const spaceIndex = textAfterAtQuery.indexOf(' ');
    const textAfterQuery = spaceIndex !== -1 ? textAfterAtQuery.slice(spaceIndex) : '';

    const newInput = textBeforeAt + '@' + file.path + ' ' + textAfterQuery;
    const newCursorPos = textBeforeAt.length + 1 + file.path.length + 1;

    // Immediately ensure focus is maintained
    if (textareaRef.current && !textareaRef.current.matches(':focus')) {
      textareaRef.current.focus();
    }

    // Update input and cursor position
    setInput(newInput);
    setCursorPosition(newCursorPos);

    // Hide dropdown
    setShowFileDropdown(false);
    setAtSymbolPosition(-1);

    // Set cursor position synchronously 
    if (textareaRef.current) {
      // Use requestAnimationFrame for smoother updates
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
          // Ensure focus is maintained
          if (!textareaRef.current.matches(':focus')) {
            textareaRef.current.focus();
          }
        }
      });
    }
  };

  const handleInputChange = (e) => {
    const newValue = e.target.value;
    setInput(newValue);
    setCursorPosition(e.target.selectionStart);

    // Handle height reset when input becomes empty
    if (!newValue.trim()) {
      e.target.style.height = 'auto';
      setIsTextareaExpanded(false);
    }
  };

  const handleTextareaClick = (e) => {
    setCursorPosition(e.target.selectionStart);
  };



  const handleNewSession = () => {
    setChatMessages([]);
    setInput('');
    setIsLoading(false);
    setCanAbortSession(false);
  };

  const handleAbortSession = () => {
    if (currentSessionId && canAbortSession) {
      sendMessage({
        type: 'abort-session',
        sessionId: currentSessionId,
        provider: provider
      });
    }
  };

  const handleModeSwitch = () => {
    const modes = ['default', 'acceptEdits', 'bypassPermissions', 'plan'];
    const currentIndex = modes.indexOf(permissionMode);
    const nextIndex = (currentIndex + 1) % modes.length;
    setPermissionMode(modes[nextIndex]);
  };

  // Don't render if no project is selected
  if (!selectedProject) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-gray-500 dark:text-gray-400">
          <p>Select a project to start chatting with Claude</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <style>
        {`
          details[open] .details-chevron {
            transform: rotate(180deg);
          }
        `}
      </style>
      <div className="h-full flex flex-col">
        {/* Messages Area - Scrollable Middle Section */}
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-y-auto overflow-x-hidden px-0 py-3 sm:p-4 space-y-3 sm:space-y-4 relative"
        >
          {isLoadingSessionMessages && chatMessages.length === 0 ? (
            <div className="text-center text-gray-500 dark:text-gray-400 mt-8">
              <div className="flex items-center justify-center space-x-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-400"></div>
                <p>Loading session messages...</p>
              </div>
            </div>
          ) : chatMessages.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              {!selectedSession && !currentSessionId && (
                <div className="text-center px-6 sm:px-4 py-8">
                  <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">Choose Your AI Assistant</h2>
                  <p className="text-gray-600 dark:text-gray-400 mb-8">
                    Select a provider to start a new conversation
                  </p>

                  <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-8">
                    {/* Claude Button */}
                    <button
                      onClick={() => {
                        setProvider('claude');
                        localStorage.setItem('selected-provider', 'claude');
                        // Focus input after selection
                        setTimeout(() => textareaRef.current?.focus(), 100);
                      }}
                      className={`group relative w-64 h-32 bg-white dark:bg-gray-800 rounded-xl border-2 transition-all duration-200 hover:scale-105 hover:shadow-xl ${provider === 'claude'
                        ? 'border-blue-500 shadow-lg ring-2 ring-blue-500/20'
                        : 'border-gray-200 dark:border-gray-700 hover:border-blue-400'
                        }`}
                    >
                      <div className="flex flex-col items-center justify-center h-full gap-3">
                        <ClaudeLogo className="w-10 h-10" />
                        <div>
                          <p className="font-semibold text-gray-900 dark:text-white">Claude</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">by Anthropic</p>
                        </div>
                      </div>
                      {provider === 'claude' && (
                        <div className="absolute top-2 right-2">
                          <div className="w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center">
                            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          </div>
                        </div>
                      )}
                    </button>

                    {/* Cursor Button */}
                    <button
                      onClick={() => {
                        setProvider('cursor');
                        localStorage.setItem('selected-provider', 'cursor');
                        // Focus input after selection
                        setTimeout(() => textareaRef.current?.focus(), 100);
                      }}
                      className={`group relative w-64 h-32 bg-white dark:bg-gray-800 rounded-xl border-2 transition-all duration-200 hover:scale-105 hover:shadow-xl ${provider === 'cursor'
                        ? 'border-purple-500 shadow-lg ring-2 ring-purple-500/20'
                        : 'border-gray-200 dark:border-gray-700 hover:border-purple-400'
                        }`}
                    >
                      <div className="flex flex-col items-center justify-center h-full gap-3">
                        <CursorLogo className="w-10 h-10" />
                        <div>
                          <p className="font-semibold text-gray-900 dark:text-white">Cursor</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">AI Code Editor</p>
                        </div>
                      </div>
                      {provider === 'cursor' && (
                        <div className="absolute top-2 right-2">
                          <div className="w-5 h-5 bg-purple-500 rounded-full flex items-center justify-center">
                            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          </div>
                        </div>
                      )}
                    </button>
                  </div>

                  {/* Model Selection for Cursor - Always reserve space to prevent jumping */}
                  <div className={`mb-6 transition-opacity duration-200 ${provider === 'cursor' ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      {provider === 'cursor' ? 'Select Model' : '\u00A0'}
                    </label>
                    <select
                      value={cursorModel}
                      onChange={(e) => {
                        const newModel = e.target.value;
                        setCursorModel(newModel);
                        localStorage.setItem('cursor-model', newModel);
                      }}
                      className="pl-4 pr-10 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 min-w-[140px]"
                      disabled={provider !== 'cursor'}
                    >
                      <option value="gpt-5">GPT-5</option>
                      <option value="sonnet-4">Sonnet-4</option>
                      <option value="opus-4.1">Opus 4.1</option>
                    </select>
                  </div>

                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {provider === 'claude'
                      ? 'Ready to use Claude AI. Start typing your message below.'
                      : provider === 'cursor'
                        ? `Ready to use Cursor with ${cursorModel}. Start typing your message below.`
                        : 'Select a provider above to begin'
                    }
                  </p>
                </div>
              )}
              {selectedSession && (
                <div className="text-center text-gray-500 dark:text-gray-400 px-6 sm:px-4">
                  <p className="font-bold text-lg sm:text-xl mb-3">Continue your conversation</p>
                  <p className="text-sm sm:text-base leading-relaxed">
                    Ask questions about your code, request changes, or get help with development tasks
                  </p>
                </div>
              )}
            </div>
          ) : (
            <>
              {/* Loading indicator for older messages */}
              {isLoadingMoreMessages && (
                <div className="text-center text-gray-500 dark:text-gray-400 py-3">
                  <div className="flex items-center justify-center space-x-2">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-400"></div>
                    <p className="text-sm">Loading older messages...</p>
                  </div>
                </div>
              )}

              {/* Indicator showing there are more messages to load */}
              {hasMoreMessages && !isLoadingMoreMessages && (
                <div className="text-center text-gray-500 dark:text-gray-400 text-sm py-2 border-b border-gray-200 dark:border-gray-700">
                  {totalMessages > 0 && (
                    <span>
                      Showing {sessionMessages.length} of {totalMessages} messages •
                      <span className="text-xs">Scroll up to load more</span>
                    </span>
                  )}
                </div>
              )}

              {/* Legacy message count indicator (for non-paginated view) */}
              {!hasMoreMessages && chatMessages.length > visibleMessageCount && (
                <div className="text-center text-gray-500 dark:text-gray-400 text-sm py-2 border-b border-gray-200 dark:border-gray-700">
                  Showing last {visibleMessageCount} messages ({chatMessages.length} total) •
                  <button
                    className="ml-1 text-blue-600 hover:text-blue-700 underline"
                    onClick={loadEarlierMessages}
                  >
                    Load earlier messages
                  </button>
                </div>
              )}

              {visibleMessages.map((message, index) => {
                const prevMessage = index > 0 ? visibleMessages[index - 1] : null;

                return (
                  <MessageComponent
                    key={index}
                    message={message}
                    index={index}
                    prevMessage={prevMessage}
                    createDiff={createDiff}
                    onFileOpen={onFileOpen}
                    onShowSettings={onShowSettings}
                    autoExpandTools={autoExpandTools}
                    showRawParameters={showRawParameters}
                  />
                );
              })}
            </>
          )}

          {isLoading && (
            <div className="chat-message assistant">
              <div className="w-full">
                <div className="flex items-center space-x-3 mb-2">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm flex-shrink-0 p-1 bg-transparent">
                    {(localStorage.getItem('selected-provider') || 'claude') === 'cursor' ? (
                      <CursorLogo className="w-full h-full" />
                    ) : (
                      <ClaudeLogo className="w-full h-full" />
                    )}
                  </div>
                  <div className="text-sm font-medium text-gray-900 dark:text-white">{(localStorage.getItem('selected-provider') || 'claude') === 'cursor' ? 'Cursor' : 'Claude'}</div>
                  {/* Abort button removed - functionality not yet implemented at backend */}
                </div>
                <div className="w-full text-sm text-gray-500 dark:text-gray-400 pl-3 sm:pl-0">
                  <div className="flex items-center space-x-1">
                    <div className="animate-pulse">●</div>
                    <div className="animate-pulse" style={{ animationDelay: '0.2s' }}>●</div>
                    <div className="animate-pulse" style={{ animationDelay: '0.4s' }}>●</div>
                    <span className="ml-2">Thinking...</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>


        {/* Input Area - Fixed Bottom */}
        <div className={`p-2 sm:p-4 md:p-4 flex-shrink-0 ${isInputFocused ? 'pb-2 sm:pb-4 md:pb-6' : 'pb-16 sm:pb-4 md:pb-6'
          }`}>

          <div className="flex-1">
            <ClaudeStatus
              status={claudeStatus}
              isLoading={isLoading}
              onAbort={handleAbortSession}
              provider={provider}
            />
          </div>
          {/* Permission Mode Selector with scroll to bottom button - Above input, clickable for mobile */}
          <div className="max-w-4xl mx-auto mb-3">
            <div className="flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={handleModeSwitch}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all duration-200 ${permissionMode === 'default'
                  ? 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600'
                  : permissionMode === 'acceptEdits'
                    ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border-green-300 dark:border-green-600 hover:bg-green-100 dark:hover:bg-green-900/30'
                    : permissionMode === 'bypassPermissions'
                      ? 'bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300 border-orange-300 dark:border-orange-600 hover:bg-orange-100 dark:hover:bg-orange-900/30'
                      : 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-600 hover:bg-blue-100 dark:hover:bg-blue-900/30'
                  }`}
                title="Click to change permission mode (or press Tab in input)"
              >
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${permissionMode === 'default'
                    ? 'bg-gray-500'
                    : permissionMode === 'acceptEdits'
                      ? 'bg-green-500'
                      : permissionMode === 'bypassPermissions'
                        ? 'bg-orange-500'
                        : 'bg-blue-500'
                    }`} />
                  <span>
                    {permissionMode === 'default' && 'Default Mode'}
                    {permissionMode === 'acceptEdits' && 'Accept Edits'}
                    {permissionMode === 'bypassPermissions' && 'Bypass Permissions'}
                    {permissionMode === 'plan' && 'Plan Mode'}
                  </span>
                </div>
              </button>

              {/* Scroll to bottom button - positioned next to mode indicator */}
              {isUserScrolledUp && chatMessages.length > 0 && (
                <button
                  onClick={scrollToBottom}
                  className="w-8 h-8 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg flex items-center justify-center transition-all duration-200 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:ring-offset-gray-800"
                  title="Scroll to bottom"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          <form onSubmit={handleSubmit} className="relative max-w-4xl mx-auto">
            {/* Drag overlay */}
            {isDragActive && (
              <div className="absolute inset-0 bg-blue-500/20 border-2 border-dashed border-blue-500 rounded-lg flex items-center justify-center z-50">
                <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-lg">
                  <svg className="w-8 h-8 text-blue-500 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  <p className="text-sm font-medium">Drop images here</p>
                </div>
              </div>
            )}

            {/* Image attachments preview */}
            {attachedImages.length > 0 && (
              <div className="mb-2 p-2 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <div className="flex flex-wrap gap-2">
                  {attachedImages.map((file, index) => (
                    <ImageAttachment
                      key={index}
                      file={file}
                      onRemove={() => {
                        setAttachedImages(prev => prev.filter((_, i) => i !== index));
                      }}
                      uploadProgress={uploadingImages.get(file.name)}
                      error={imageErrors.get(file.name)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* File dropdown - positioned outside dropzone to avoid conflicts */}
            {showFileDropdown && filteredFiles.length > 0 && (
              <div className="absolute bottom-full left-0 right-0 mb-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg max-h-48 overflow-y-auto z-50 backdrop-blur-sm">
                {filteredFiles.map((file, index) => (
                  <div
                    key={file.path}
                    className={`px-4 py-3 cursor-pointer border-b border-gray-100 dark:border-gray-700 last:border-b-0 touch-manipulation ${index === selectedFileIndex
                      ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'
                      }`}
                    onMouseDown={(e) => {
                      // Prevent textarea from losing focus on mobile
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      selectFile(file);
                    }}
                  >
                    <div className="font-medium text-sm">{file.name}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                      {file.path}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div {...getRootProps()} className={`relative bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-600 focus-within:ring-2 focus-within:ring-blue-500 dark:focus-within:ring-blue-500 focus-within:border-blue-500 transition-all duration-200 ${isTextareaExpanded ? 'chat-input-expanded' : ''}`}>
              <input {...getInputProps()} />
              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleInputChange}
                onClick={handleTextareaClick}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                onFocus={() => setIsInputFocused(true)}
                onBlur={() => setIsInputFocused(false)}
                onInput={(e) => {
                  // Immediate resize on input for better UX
                  e.target.style.height = 'auto';
                  e.target.style.height = e.target.scrollHeight + 'px';
                  setCursorPosition(e.target.selectionStart);

                  // Check if textarea is expanded (more than 2 lines worth of height)
                  const lineHeight = parseInt(window.getComputedStyle(e.target).lineHeight);
                  const isExpanded = e.target.scrollHeight > lineHeight * 2;
                  setIsTextareaExpanded(isExpanded);
                }}
                placeholder="Ask Claude to help with your code... (@ to reference files)"
                disabled={isLoading}
                rows={1}
                className="chat-input-placeholder w-full pl-12 pr-28 sm:pr-40 py-3 sm:py-4 bg-transparent rounded-2xl focus:outline-none text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 disabled:opacity-50 resize-none min-h-[40px] sm:min-h-[56px] max-h-[40vh] sm:max-h-[300px] overflow-y-auto text-sm sm:text-base transition-all duration-200"
                style={{ height: 'auto' }}
              />
              {/* Clear button - shown when there's text */}
              {input.trim() && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setInput('');
                    if (textareaRef.current) {
                      textareaRef.current.style.height = 'auto';
                      textareaRef.current.focus();
                    }
                    setIsTextareaExpanded(false);
                  }}
                  onTouchEnd={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setInput('');
                    if (textareaRef.current) {
                      textareaRef.current.style.height = 'auto';
                      textareaRef.current.focus();
                    }
                    setIsTextareaExpanded(false);
                  }}
                  className="absolute -left-0.5 -top-3 sm:right-28 sm:left-auto sm:top-1/2 sm:-translate-y-1/2 w-6 h-6 sm:w-8 sm:h-8 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 border border-gray-300 dark:border-gray-600 rounded-full flex items-center justify-center transition-all duration-200 group z-10 shadow-sm"
                  title="Clear input"
                >
                  <svg
                    className="w-3 h-3 sm:w-4 sm:h-4 text-gray-600 dark:text-gray-300 group-hover:text-gray-800 dark:group-hover:text-gray-100 transition-colors"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              )}
              {/* Image upload button */}
              <button
                type="button"
                onClick={open}
                className="absolute left-2 bottom-4 p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                title="Attach images"
              >
                <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </button>

              {/* Mic button - HIDDEN */}
              <div className="absolute right-16 sm:right-16 top-1/2 transform -translate-y-1/2" style={{ display: 'none' }}>
                <MicButton
                  onTranscript={handleTranscript}
                  className="w-10 h-10 sm:w-10 sm:h-10"
                />
              </div>
              {/* Send button */}
              <button
                type="submit"
                disabled={!input.trim() || isLoading}
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleSubmit(e);
                }}
                onTouchStart={(e) => {
                  e.preventDefault();
                  handleSubmit(e);
                }}
                className="absolute right-2 top-1/2 transform -translate-y-1/2 w-12 h-12 sm:w-12 sm:h-12 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed rounded-full flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:ring-offset-gray-800"
              >
                <svg
                  className="w-4 h-4 sm:w-5 sm:h-5 text-white transform rotate-90"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                  />
                </svg>
              </button>
            </div>
            {/* Hint text */}
            <div className="text-xs text-gray-500 dark:text-gray-400 text-center mt-2 hidden sm:block">
              {sendByCtrlEnter
                ? "Ctrl+Enter to send (IME safe) • Shift+Enter for new line • Tab to change modes • @ to reference files"
                : "Press Enter to send • Shift+Enter for new line • Tab to change modes • @ to reference files"}
            </div>
            <div className={`text-xs text-gray-500 dark:text-gray-400 text-center mt-2 sm:hidden transition-opacity duration-200 ${isInputFocused ? 'opacity-100' : 'opacity-0'
              }`}>
              {sendByCtrlEnter
                ? "Ctrl+Enter to send (IME safe) • Tab for modes • @ for files"
                : "Enter to send • Tab for modes • @ for files"}
            </div>
          </form>
        </div>
      </div>
    </>
  );
}

export default React.memo(ChatInterface);