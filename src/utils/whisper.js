import { api } from './api';

export async function transcribeWithWhisper(audioBlob, onStatusChange) {
    const formData = new FormData();
    const fileName = `recording_${Date.now()}.webm`;
    const file = new File([audioBlob], fileName, { type: audioBlob.type });
    
    formData.append('audio', file);
    
    const whisperMode = window.localStorage.getItem('whisperMode') || 'default';
    const whisperLanguage = window.localStorage.getItem('whisperLanguage') || 'auto';
    const useLocalWhisper = window.localStorage.getItem('useLocalWhisper') === 'true';
    
    formData.append('mode', whisperMode);
    formData.append('language', whisperLanguage);
    formData.append('useLocal', useLocalWhisper.toString());
  
    try {
      // Start with transcribing state
      if (onStatusChange) {
        onStatusChange('transcribing');
      }
  
      const response = await api.transcribe(formData);
  
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.error || 
          `Transcription error: ${response.status} ${response.statusText}`
        );
      }
  
      const data = await response.json();
      return data.text || '';
    } catch (error) {
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        throw new Error('Cannot connect to server. Please ensure the backend is running.');
      }
      throw error;
    }
  }
  
  // Get available languages for Whisper
  export function getWhisperLanguages() {
    return [
      { code: 'auto', name: '自动检测' },
      { code: 'zh', name: '中文' },
      { code: 'en', name: 'English' },
      { code: 'ja', name: '日本語' },
      { code: 'ko', name: '한국어' },
      { code: 'es', name: 'Español' },
      { code: 'fr', name: 'Français' },
      { code: 'de', name: 'Deutsch' },
      { code: 'it', name: 'Italiano' },
      { code: 'pt', name: 'Português' },
      { code: 'ru', name: 'Русский' },
      { code: 'ar', name: 'العربية' },
      { code: 'hi', name: 'हिन्दी' }
    ];
  }