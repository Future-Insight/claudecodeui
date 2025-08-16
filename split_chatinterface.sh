#!/bin/bash

# ChatInterface.jsx 拆分脚本
# 将3457行的文件拆分为4个文件

set -e

echo "开始拆分 ChatInterface.jsx..."

# 检查原文件是否存在
ORIGINAL_FILE="src/components/ChatInterface.jsx"
if [ ! -f "$ORIGINAL_FILE" ]; then
    echo "错误: $ORIGINAL_FILE 不存在"
    exit 1
fi

# 创建备份
echo "创建备份文件..."
cp "$ORIGINAL_FILE" "${ORIGINAL_FILE}.backup"

# 1. 提取 chatUtils.js (工具函数)
echo "提取工具函数到 chatUtils.js..."
cat > src/utils/chatUtils.js << 'EOF'
// Format "Claude AI usage limit reached|<epoch>" into a local time string
export function formatUsageLimitText(text) {
  try {
    if (typeof text !== 'string') return text;
    return text.replace(/Claude AI usage limit reached\|(\d{10,13})/g, (match, ts) => {
      let timestampMs = parseInt(ts, 10);
      if (!Number.isFinite(timestampMs)) return match;
      if (timestampMs < 1e12) timestampMs *= 1000; // seconds → ms
      const reset = new Date(timestampMs);

      // Time HH:mm in local time
      const timeStr = new Intl.DateTimeFormat(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      }).format(reset);

      // Human-readable timezone: GMT±HH[:MM] (City)
      const offsetMinutesLocal = -reset.getTimezoneOffset();
      const sign = offsetMinutesLocal >= 0 ? '+' : '-';
      const abs = Math.abs(offsetMinutesLocal);
      const offH = Math.floor(abs / 60);
      const offM = abs % 60;
      const gmt = `GMT${sign}${offH}${offM ? ':' + String(offM).padStart(2, '0') : ''}`;
      const tzId = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      const cityRaw = tzId.split('/').pop() || '';
      const city = cityRaw
        .replace(/_/g, ' ')
        .toLowerCase()
        .replace(/\b\w/g, c => c.toUpperCase());
      const tzHuman = city ? `${gmt} (${city})` : gmt;

      // Readable date like "8 Jun 2025"
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const dateReadable = `${reset.getDate()} ${months[reset.getMonth()]} ${reset.getFullYear()}`;

      return `Claude usage limit reached. Your limit will reset at **${timeStr} ${tzHuman}** - ${dateReadable}`;
    });
  } catch {
    return text;
  }
}

// Safe localStorage utility to handle quota exceeded errors
export const safeLocalStorage = {
  setItem: (key, value) => {
    try {
      // For chat messages, implement compression and size limits
      if (key.startsWith('chat_messages_') && typeof value === 'string') {
        try {
          const parsed = JSON.parse(value);
          // Limit to last 50 messages to prevent storage bloat
          if (Array.isArray(parsed) && parsed.length > 50) {
            console.warn(`Truncating chat history for ${key} from ${parsed.length} to 50 messages`);
            const truncated = parsed.slice(-50);
            value = JSON.stringify(truncated);
          }
        } catch (parseError) {
          console.warn('Could not parse chat messages for truncation:', parseError);
        }
      }
      
      localStorage.setItem(key, value);
    } catch (error) {
      if (error.name === 'QuotaExceededError') {
        console.warn('localStorage quota exceeded, clearing old data');
        // Clear old chat messages to free up space
        const keys = Object.keys(localStorage);
        const chatKeys = keys.filter(k => k.startsWith('chat_messages_')).sort();
        
        // Remove oldest chat sessions first
        for (let i = 0; i < Math.min(5, chatKeys.length); i++) {
          try {
            localStorage.removeItem(chatKeys[i]);
            console.log(`Removed old chat session: ${chatKeys[i]}`);
          } catch (removeError) {
            console.warn('Error removing old chat session:', removeError);
          }
        }
        
        // Try setting the item again
        try {
          localStorage.setItem(key, value);
        } catch (retryError) {
          console.error('Failed to save to localStorage even after cleanup:', retryError);
        }
      } else {
        console.error('localStorage error:', error);
      }
    }
  },
  
  getItem: (key) => {
    try {
      return localStorage.getItem(key);
    } catch (error) {
      console.error('Error reading from localStorage:', error);
      return null;
    }
  },
  
  removeItem: (key) => {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.error('Error removing from localStorage:', error);
    }
  }
};

// Calculate diff between original and new content
export function calculateDiff(original, modified) {
  if (!original || !modified) return { additions: 0, deletions: 0 };
  
  const originalLines = original.split('\n');
  const modifiedLines = modified.split('\n');
  
  // Simple line-based diff calculation
  const maxLength = Math.max(originalLines.length, modifiedLines.length);
  let additions = 0;
  let deletions = 0;
  
  for (let i = 0; i < maxLength; i++) {
    const origLine = originalLines[i] || '';
    const modLine = modifiedLines[i] || '';
    
    if (i >= originalLines.length) {
      additions++;
    } else if (i >= modifiedLines.length) {
      deletions++;
    } else if (origLine !== modLine) {
      if (origLine.length === 0) {
        additions++;
      } else if (modLine.length === 0) {
        deletions++;
      } else {
        // Line modified - count as both addition and deletion
        additions++;
        deletions++;
      }
    }
  }
  
  return { additions, deletions };
}

// Flatten file tree for display
export function flattenFileTree(tree, prefix = '', result = []) {
  if (!tree || typeof tree !== 'object') return result;
  
  Object.keys(tree).sort().forEach(key => {
    const value = tree[key];
    const fullPath = prefix ? `${prefix}/${key}` : key;
    
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      // Directory
      result.push({ type: 'directory', path: fullPath, name: key });
      flattenFileTree(value, fullPath, result);
    } else {
      // File
      result.push({ type: 'file', path: fullPath, name: key });
    }
  });
  
  return result;
}

// Convert session messages for storage
export function convertSessionMessages(messages) {
  if (!Array.isArray(messages)) return [];
  
  return messages.map(msg => {
    if (!msg || typeof msg !== 'object') return msg;
    
    const converted = {
      role: msg.role || 'user',
      content: msg.content || '',
      timestamp: msg.timestamp || Date.now()
    };
    
    // Preserve attachments if they exist
    if (msg.attachments) {
      converted.attachments = msg.attachments;
    }
    
    // Preserve tool calls if they exist
    if (msg.tool_calls) {
      converted.tool_calls = msg.tool_calls;
    }
    
    return converted;
  });
}
EOF

# 2. 提取 MessageComponent.jsx (行 157-1120)
echo "提取 MessageComponent 到独立文件..."
sed -n '157,1120p' "$ORIGINAL_FILE" > temp_message.jsx

# 创建完整的 MessageComponent.jsx
cat > src/components/MessageComponent.jsx << 'EOF'
import React, { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';
import ReactMarkdown from 'react-markdown';
import TodoList from './TodoList';

EOF

# 添加提取的内容
cat temp_message.jsx >> src/components/MessageComponent.jsx
rm temp_message.jsx

# 3. 提取 ImageAttachment.jsx (行 1121-1164)
echo "提取 ImageAttachment 组件..."
sed -n '1121,1164p' "$ORIGINAL_FILE" > temp_image.jsx

# 创建完整的 ImageAttachment.jsx
cat > src/components/ImageAttachment.jsx << 'EOF'
import React, { useState } from 'react';

EOF

# 添加提取的内容
cat temp_image.jsx >> src/components/ImageAttachment.jsx
rm temp_image.jsx

# 4. 创建新的主 ChatInterface.jsx
echo "创建新的主 ChatInterface.jsx..."
cat > "$ORIGINAL_FILE" << 'EOF'
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
import MessageComponent from './MessageComponent.jsx';
import ImageAttachment from './ImageAttachment.jsx';
import { formatUsageLimitText, safeLocalStorage, calculateDiff, flattenFileTree, convertSessionMessages } from '../utils/chatUtils.js';

EOF

# 添加主文件的其余内容（跳过已提取的部分）
sed '1,31d; 157,1164d' "$ORIGINAL_FILE.backup" >> "$ORIGINAL_FILE"

echo "拆分完成！"
echo ""
echo "已创建以下文件："
echo "- src/utils/chatUtils.js (工具函数)"
echo "- src/components/MessageComponent.jsx (消息组件)"
echo "- src/components/ImageAttachment.jsx (图片附件组件)"
echo "- src/components/ChatInterface.jsx (更新后的主文件)"
echo ""
echo "备份文件: ${ORIGINAL_FILE}.backup"
echo ""
echo "请检查生成的文件并进行必要的调整。"