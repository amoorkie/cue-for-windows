const { contextBridge, ipcRenderer, webFrame } = require('electron');
const surface = process.argv.find(arg => arg.startsWith('--cue-surface='))?.split('=')[1] || 'panel';

contextBridge.exposeInMainWorld('cue', {
  surface,
  surfaceReady: () => ipcRenderer.send('surface:ready'),
  windowOpen: key => ipcRenderer.invoke('window:open', key),
  windowToggle: key => ipcRenderer.invoke('window:toggle', key),
  windowClose: () => ipcRenderer.invoke('window:close'),
  windowReset: () => ipcRenderer.invoke('window:reset'),
  workspaceToggle: () => ipcRenderer.invoke('workspace:toggle'),
  workspaceState: () => ipcRenderer.invoke('workspace:state'),
  gestureStart: gesture => ipcRenderer.send('window:gesture-start', gesture),
  gestureEnd: commit => ipcRenderer.send('window:gesture-end', commit),
  displaysGet: () => ipcRenderer.invoke('displays:get'),
  displaySelect: id => ipcRenderer.invoke('displays:select', id),
  audioLevel: level => ipcRenderer.send('audio:level', level),
  captureHealth: health => ipcRenderer.send('capture:health', health),
  setZoomLevel: (level) => webFrame.setZoomLevel(level),
  getZoomLevel: () => webFrame.getZoomLevel(),
  platform: process.platform,
  settingsGet: () => ipcRenderer.invoke('settings:get'),
  settingsSet: (patch) => ipcRenderer.invoke('settings:set', patch),
  localSttCheck: (config) => ipcRenderer.invoke('local-stt:check', config),
  localSttFolder: () => ipcRenderer.invoke('local-stt:folder'),
  localSttSetup: () => ipcRenderer.invoke('local-stt:setup'),
  ask: (payload) => ipcRenderer.send('ask', payload),
  assistToggle: () => ipcRenderer.invoke('assist:toggle'),
  captureToggle: () => ipcRenderer.invoke('capture:toggle'),
  captureFinishRaw: () => ipcRenderer.invoke('capture:finish-raw'),
  captureState: () => ipcRenderer.invoke('capture:state'),
  sessionsList: () => ipcRenderer.invoke('sessions:list'),
  sessionOpen: (filePath) => ipcRenderer.invoke('sessions:open', filePath),
  sessionSummary: (filePath) => ipcRenderer.invoke('sessions:summary', filePath),
  sessionContinue: (filePath) => ipcRenderer.invoke('sessions:continue', filePath),
  sessionDismiss: (filePath) => ipcRenderer.invoke('sessions:dismiss', filePath),
  catalogSearch: (query) => ipcRenderer.invoke('catalog:search', query),
  catalogOpen: (filePath) => ipcRenderer.invoke('catalog:open', filePath),
  catalogExport: (filePath, format) => ipcRenderer.invoke('catalog:export', filePath, format),
  catalogExtract: (filePath, kind) => ipcRenderer.invoke('catalog:extract', filePath, kind),
  micPcm: (arrayBuffer) => ipcRenderer.send('mic:pcm', arrayBuffer),
  systemPcm: (arrayBuffer) => ipcRenderer.send('system:pcm', arrayBuffer),
  setIgnoreMouse: (v) => ipcRenderer.send('mouse:ignore', v),
  hideToTray: () => ipcRenderer.send('window:hide-to-tray'),
  openPane: (url) => ipcRenderer.send('open-pane', url),
  log: (msg) => ipcRenderer.send('log', msg),
  on: (channel, cb) => {
    const allowed = ['capture:state', 'capture:health', 'audio:level', 'llm:start', 'llm:metadata', 'llm:token', 'llm:done', 'llm:error', 'status', 'transcript', 'transcript:updated', 'settings:open', 'settings:changed', 'diagnostics', 'recovery:available', 'session:loaded', 'local-stt:progress', 'workspace:state', 'surface:opened', 'surface:close', 'displays:changed'];
    if (!allowed.includes(channel)) return;
    ipcRenderer.on(channel, (_e, data) => cb(data));
  }
});
