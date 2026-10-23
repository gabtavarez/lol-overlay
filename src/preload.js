const { contextBridge, ipcRenderer } = require('electron');

// Ponte mínima e segura entre o processo principal e a página do overlay.
contextBridge.exposeInMainWorld('overlay', {
  onState: (cb) => ipcRenderer.on('state', (_e, state) => cb(state)),
  onStatus: (cb) => ipcRenderer.on('status', (_e, status) => cb(status)),
  onClickThrough: (cb) => ipcRenderer.on('click-through', (_e, value) => cb(value)),
  ready: () => ipcRenderer.send('renderer-ready'),
  openMultisearch: (side) => ipcRenderer.invoke('open-multisearch', side),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  getGuide: (championId) => ipcRenderer.invoke('guide:get', championId),
  importBuild: (championId, what) => ipcRenderer.invoke('import:build', { championId, what }),
  onGuideUpdated: (cb) => ipcRenderer.on('guide-updated', (_e, p) => cb(p)),
  setInteractive: (on) => ipcRenderer.send('overlay:interactive', Boolean(on)),
  getUpdate: () => ipcRenderer.invoke('update:get'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdate: (cb) => ipcRenderer.on('update', (_e, s) => cb(s)),
  previewOverlay: () => ipcRenderer.invoke('overlay:preview'),
  onPreview: (cb) => ipcRenderer.on('preview', (_e, on) => cb(on)),
  getDiagnostics: () => ipcRenderer.invoke('diag:get'),
  onMoveMode: (cb) => ipcRenderer.on('move-mode', (_e, on) => cb(on)),
  toggleMoveMode: () => ipcRenderer.invoke('overlay:toggle-move'),
  openDataFolder: () => ipcRenderer.invoke('open-data-folder'),
});
