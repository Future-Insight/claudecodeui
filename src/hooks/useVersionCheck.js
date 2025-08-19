// hooks/useVersionCheck.js
import { useState, useEffect } from 'react';
import { version } from '../../package.json';

export const useVersionCheck = (owner, repo) => {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [latestVersion, setLatestVersion] = useState(null);

  useEffect(() => {
    // Disable version checking
    setUpdateAvailable(false);
    setLatestVersion(null);
  }, [owner, repo]);

  return { updateAvailable, latestVersion, currentVersion: version };
}; 