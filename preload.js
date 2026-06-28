const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcherAPI', {
  getApps: () => ipcRenderer.invoke('launcher:get-apps'),

  // --- Activation System ---
  getMachineId: () => ipcRenderer.invoke('get-machine-id'),
  submitActivationKey: (key) => ipcRenderer.invoke('submit-activation-key', key),
  startTrial: () => ipcRenderer.invoke('start-trial'),
  getAccountInfo: () => ipcRenderer.invoke('get-account-info'),
  logout: () => ipcRenderer.invoke('logout'),
  reloadApp: () => ipcRenderer.invoke('reload-app'),

  downloadApp: (appConfig) => ipcRenderer.invoke('launcher:download-app', appConfig),
  pauseDownload: (appId) => ipcRenderer.invoke('launcher:pause-download', appId),
  resumeDownload: (appId) => ipcRenderer.invoke('launcher:resume-download', appId),
  getPendingDownloads: () => ipcRenderer.invoke('launcher:get-pending-downloads'),
  launchApp: (appConfig) => ipcRenderer.invoke('launcher:launch-app', appConfig),
  openFolder: (appConfig) => ipcRenderer.invoke('launcher:open-folder', appConfig),
  uninstallApp: (appId) => ipcRenderer.invoke('launcher:uninstall-app', appId),

  // Listeners
  onDownloadProgress: (callback) => ipcRenderer.on('download-progress', (event, data) => callback(data)),
  onLauncherUpdateStatus: (callback) => ipcRenderer.on('launcher-update-status', (event, data) => callback(data)),
  onOnlineUserCount: (callback) => ipcRenderer.on('online-user-count', (event, count) => callback(count)),
  getOnlineStatus: () => ipcRenderer.invoke('launcher:get-online-status'),
  getUpdateStatus: () => ipcRenderer.invoke('launcher:get-update-status'),

  getAppVersion: () => ipcRenderer.invoke('launcher:get-app-version'),
  startUpdateDownload: () => ipcRenderer.invoke('launcher:start-update-download'),
  installUpdate: () => ipcRenderer.invoke('launcher:install-update'),

  // Utils
  openExternal: (url) => ipcRenderer.invoke('launcher:open-external', url)
});
