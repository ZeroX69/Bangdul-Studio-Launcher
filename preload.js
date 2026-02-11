const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcherAPI', {
  getApps: () => ipcRenderer.invoke('launcher:get-apps'),

  // --- Activation System ---
  getMachineId: () => ipcRenderer.invoke('get-machine-id'),
  submitActivationKey: (key) => ipcRenderer.invoke('submit-activation-key', key),
  getAccountInfo: () => ipcRenderer.invoke('get-account-info'),
  logout: () => ipcRenderer.invoke('logout'),
  reloadApp: () => ipcRenderer.invoke('reload-app'),

  downloadApp: (appConfig) => ipcRenderer.invoke('launcher:download-app', appConfig),
  launchApp: (appConfig) => ipcRenderer.invoke('launcher:launch-app', appConfig),
  openFolder: (appConfig) => ipcRenderer.invoke('launcher:open-folder', appConfig),

  // Listeners
  onDownloadProgress: (callback) => ipcRenderer.on('download-progress', (event, data) => callback(data)),
  onLauncherUpdate: (callback) => ipcRenderer.on('launcher-update-available', (event, data) => callback(data)),

  // Launcher Self-Update
  downloadLauncherUpdate: (url) => ipcRenderer.invoke('launcher:download-update', url),
  installLauncherUpdate: () => ipcRenderer.invoke('launcher:install-update'),
  onLauncherDownloadProgress: (callback) => ipcRenderer.on('launcher-download-progress', (event, progress) => callback(progress)),

  // Utils
  openExternal: (url) => shell.openExternal(url)
});

