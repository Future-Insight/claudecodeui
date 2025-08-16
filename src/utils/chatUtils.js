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
