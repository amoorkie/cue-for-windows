const path = require('node:path');
const { SURFACES, normalizeLayout, legacyLayout, reachableBounds, resizeBounds } = require('./window-layout');

class CueWindows {
  constructor({ electron, store, onReady, onQuit, isQuitting }) {
    this.electron = electron;
    this.store = store;
    this.onReady = onReady;
    this.onQuit = onQuit;
    this.isQuitting = isQuitting;
    this.windows = new Map();
    this.visible = new Set(['panel', 'toolbar']);
    this.workspaceHidden = false;
    this.hiddenToTray = false;
    const { screen, ipcMain } = electron;
    const settings = store.getSettings();
    if (settings.captureDisplayId == null) store.setSettings({ captureDisplayId: String(screen.getPrimaryDisplay().id) });
    const migrated = legacyLayout(settings.appearance, screen.getPrimaryDisplay());
    this.layout = { ...migrated, ...normalizeLayout(settings.windowLayout).windows };
    for (const key of SURFACES) this.layout[key] = reachableBounds(this.layout[key], screen.getAllDisplays());
    this.saveLayout();
    ipcMain.handle('window:open', (e, key) => this.isOwn(e) && this.open(key));
    ipcMain.handle('window:toggle', (e, key) => this.isOwn(e) && this.toggle(key));
    ipcMain.handle('window:close', (e) => this.isOwn(e) && this.hide(this.keyFor(e.sender)));
    ipcMain.handle('window:reset', (e) => this.isOwn(e) && this.reset());
    ipcMain.handle('workspace:toggle', (e) => this.isOwn(e) && this.toggleWorkspace());
    ipcMain.handle('workspace:state', () => this.snapshot());
    ipcMain.on('window:gesture-start', (e, gesture) => { if (this.isOwn(e)) this.startGesture(this.keyFor(e.sender), gesture); });
    ipcMain.on('window:gesture-end', (e, commit) => { if (this.keyFor(e.sender) === this.gesture?.key) this.finishGesture(commit !== false); });
    ipcMain.on('surface:ready', (e) => {
      const key = this.keyFor(e.sender);
      if (!key) return;
      const window = this.windows.get(key);
      window.cueReady = true;
      if (this.shouldShow(key)) window.showInactive();
      this.broadcastState();
      this.onReady?.(key, window);
    });
    for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(event, () => this.recover());
  }

  keyFor(webContents) { return [...this.windows].find(([, w]) => w.webContents === webContents)?.[0]; }
  isOwn(event) { return !!this.keyFor(event.sender); }
  snapshot() { return { visible: [...this.visible], workspaceHidden: this.workspaceHidden, hiddenToTray: this.hiddenToTray }; }
  shouldShow(key) { return !this.hiddenToTray && this.visible.has(key) && (!this.workspaceHidden || key === 'toolbar'); }
  get(key) { return this.windows.get(key); }

  ensure(key) {
    if (!SURFACES.includes(key)) return null;
    if (this.windows.has(key)) return this.windows.get(key);
    const { BrowserWindow } = this.electron;
    const { x, y, width, height } = this.layout[key];
    const window = new BrowserWindow({ x, y, width, height, show: false,
      title: `Cue · ${key}`, frame: false, transparent: true, hasShadow: false, resizable: false,
      skipTaskbar: true, alwaysOnTop: true, fullscreenable: false,
      webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true,
        nodeIntegration: false, sandbox: false, backgroundThrottling: false,
        additionalArguments: [`--cue-surface=${key}`] }
    });
    window.cueSurface = key;
    this.windows.set(key, window);
    window.setContentProtection(!process.env.CUE_NO_PROTECT);
    if (process.platform === 'darwin') {
      window.setAlwaysOnTop(true, 'screen-saver', 1);
      window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      window.setHiddenInMissionControl?.(true);
    }
    window.on('close', event => {
      if (this.isQuitting()) return;
      event.preventDefault();
      if (key === 'settings') window.webContents.send('surface:close');
      else if (key === 'panel' || key === 'toolbar') this.onQuit();
      else this.hide(key);
    });
    window.on('closed', () => { this.finishGesture(false); this.windows.delete(key); });
    window.webContents.on('render-process-gone', () => this.finishGesture(false));
    window.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    return window;
  }

  open(key) {
    const window = this.ensure(key);
    if (!window) return false;
    const alreadyVisible = this.shouldShow(key);
    this.visible.add(key);
    this.workspaceHidden = false;
    this.hiddenToTray = false;
    this.syncVisibility();
    if (window.cueReady) {
      if (!alreadyVisible) window.webContents.send('surface:opened');
      window.focus();
    }
    return true;
  }
  hide(key) { this.visible.delete(key); this.syncVisibility(); return true; }
  toggle(key) {
    if (this.shouldShow(key)) {
      if (key === 'settings') this.get(key)?.webContents.send('surface:close');
      else this.hide(key);
    } else this.open(key);
    return true;
  }
  toggleWorkspace() { this.workspaceHidden = !this.workspaceHidden; this.syncVisibility(); return this.snapshot(); }
  showAll() { this.hiddenToTray = false; this.workspaceHidden = false; this.visible.add('panel'); this.visible.add('toolbar'); this.ensure('panel'); this.ensure('toolbar'); this.syncVisibility(); }
  hideAll() { this.hiddenToTray = true; this.syncVisibility(); }
  syncVisibility() {
    for (const [key, window] of this.windows) {
      if (this.shouldShow(key) && window.cueReady) {
        if (window.isMinimized()) window.restore();
        if (!window.isVisible()) window.showInactive();
      }
      else window.hide();
    }
    this.broadcastState();
  }
  broadcastState() { this.send('workspace:state', this.snapshot()); }
  send(channel, data, targets) {
    for (const [key, window] of this.windows) if (!window.isDestroyed() && (!targets || targets.includes(key))) window.webContents.send(channel, data);
  }
  saveLayout() { this.store.setSettings({ windowLayout: { version: 2, windows: this.layout } }); }
  setBounds(key, rect) {
    const window = this.get(key);
    const { x, y, width, height } = rect;
    this.layout[key] = { ...this.layout[key], ...rect };
    if (window && !window.isDestroyed()) window.setBounds({ x, y, width, height });
  }
  reset() {
    this.finishGesture(false);
    const a = { ...this.store.getSettings().appearance, panelPositions: {} };
    const defaults = legacyLayout(a, this.electron.screen.getPrimaryDisplay());
    for (const key of SURFACES) {
      const size = this.layout[key];
      this.layout[key] = { ...defaults[key], width: size.width, height: size.height };
    }
    this.recover();
    return true;
  }
  recover() {
    this.finishGesture(true);
    for (const key of SURFACES) this.setBounds(key, reachableBounds(this.layout[key], this.electron.screen.getAllDisplays()));
    this.saveLayout();
    this.send('displays:changed');
  }
  startGesture(key, gesture = {}) {
    if (this.store.getSettings().appearance.windowDrag === false && !gesture.edge) return;
    if (!this.shouldShow(key)) return;
    this.finishGesture(true);
    const edge = ['left', 'right', 'top', 'bottom'].includes(gesture.edge) ? gesture.edge : null;
    if (edge && key === 'toolbar') return;
    const keys = gesture.group && !edge ? [...this.windows.keys()].filter(k => this.shouldShow(k)) : [key];
    this.gesture = { key, edge, start: this.electron.screen.getCursorScreenPoint(),
      bounds: Object.fromEntries(keys.map(k => [k, this.get(k).getBounds()])) };
    this.get(key).setIgnoreMouseEvents(false);
    this.gestureTimer = setInterval(() => this.moveGesture(this.electron.screen.getCursorScreenPoint()), 16);
  }
  moveGesture(point) {
    if (!this.gesture) return;
    const { start, bounds, edge, key } = this.gesture;
    const dx = point.x - start.x, dy = point.y - start.y;
    for (const [k, rect] of Object.entries(bounds)) this.setBounds(k, edge
      ? resizeBounds(rect, edge, dx, dy, key)
      : { ...rect, x: Math.round(rect.x + dx), y: Math.round(rect.y + dy) });
  }
  finishGesture(commit = true) {
    clearInterval(this.gestureTimer);
    if (!this.gesture) return;
    const gesture = this.gesture;
    this.gesture = null;
    for (const [key, rect] of Object.entries(gesture.bounds)) this.setBounds(key,
      commit ? reachableBounds(this.layout[key], this.electron.screen.getAllDisplays()) : rect);
    this.saveLayout();
  }
}

module.exports = { CueWindows };
