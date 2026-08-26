const DEBUG = false; // Set to false to disable debug logging
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, globalShortcut, screen, session, desktopCapturer, shell, Notification, dialog, powerSaveBlocker } = require('electron');
const path = require('path');
const store = require('./src/store');
const { captureScreenshot } = require('./src/screen');
const { createSTT } = require('./src/stt');
const { createLLM } = require('./src/llm');
const { MODES } = require('./src/prompts');
const { rms16 } = require('./src/wav');
const { saveRecap, saveTranscriptFallback } = require('./src/recap-export');
const { SessionJournal } = require('./src/session-journal');
const { searchCatalog, buildCatalog } = require('./src/meeting-catalog');
const { exportDocx, exportPdf } = require('./src/meeting-export');

const CUE_DOCUMENTS_DIRECTORY = process.platform === 'win32'
  ? 'A:\\Cue Documents'
  : path.join(app.getPath('documents'), 'Cue Documents');

let win = null;
let tray = null;
const startupWarnings = [];
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) app.quit();

// -------- capture / transcript state --------
const state = { capturing: false, busy: false, transcribing: { you: false, them: false } };
let sttDisabled = false; // set when the key can't reach any speech model (stops retry spam)
const buffers = { you: [], them: [] };
const transcript = []; // { channel, text, ts }
const sessionJournal = new SessionJournal(CUE_DOCUMENTS_DIRECTORY);
let recoverySessions = [];
let powerBlockerId = null;
let allowQuit = false;
const FLUSH_MS = 2200;
const MIN_BYTES = Math.floor(16000 * 2 * 0.6); // ~0.6s
const RMS_GATE = 240;
let flushTimer = null;
let captureGeneration = 0;
const STOP_DRAIN_MS = 300;
let finalizingGeneration = null;
let finalizationPromise = null;
const pendingTranscriptions = { you: null, them: null };
const ASSIST_IDLE_MS = 700;
let assistActive = false;
let assistTimer = null;
let assistQueued = false;
let assistTurnCount = 0;

function send(channel, data) { if (win && !win.isDestroyed()) win.webContents.send(channel, data); }
function sendDiagnostics(patch) { send('diagnostics', patch); }
function notify(title, body, filePath) {
  if (!Notification.isSupported()) return;
  const notification = new Notification({ title, body, silent: false });
  if (filePath) notification.on('click', () => shell.showItemInFolder(filePath));
  notification.show();
}
function parseSpeakerTurns(channel, text) {
  if (channel !== 'them') return [{ channel, speaker: 'Вы', text: String(text).trim(), ts: Date.now() }];
  const lines = String(text).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const parsed = lines.map((line) => {
    const match = line.match(/^\[?SPEAKER[_ ]?(\d+)\]?\s*[:\-]?\s*(.*)$/i);
    return match && match[2] ? { channel, speaker: `Клиент ${match[1]}`, text: match[2], ts: Date.now() } : null;
  }).filter(Boolean);
  return parsed.length ? parsed : [{ channel, speaker: 'Клиент 1', text: String(text).trim(), ts: Date.now() }];
}

function enableAutoLaunch() {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  try {
    app.setLoginItemSettings({ openAtLogin: true, path: process.execPath });
    const loginSettings = app.getLoginItemSettings({ path: process.execPath });
    if (!loginSettings.openAtLogin) startupWarnings.push('Не удалось включить автозапуск cue вместе с Windows.');
  } catch (error) {
    console.log('[startup] auto-launch error', error && error.message);
    startupWarnings.push('Не удалось включить автозапуск cue вместе с Windows.');
  }
}

const SCREEN_HINTS = ['экран', 'скрин', 'код', 'задач', 'leetcode', 'ошибк', 'сайт', 'страниц', 'кнопк', 'таблиц', 'консол', 'терминал', 'интерфейс', 'формул', 'график', 'screen', 'screenshot', 'code', 'error', 'page', 'button', 'table', 'console'];
function shouldCaptureScreen(mode, userText) {
  if (mode === 'leetcode') return true;
  if (mode === 'recap') return state.capturing;
  if (mode !== 'assist' && mode !== 'ask') return false;
  if (mode === 'assist' && !userText) return false;
  const context = [userText || '', ...transcript.slice(-6).map((turn) => turn.text)].join(' ').toLowerCase();
  return SCREEN_HINTS.some((hint) => context.includes(hint));
}

const DUPLICATE_WINDOW_MS = 12000;
function normalizeSpeech(text) {
  return String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}
function isDuplicateTurn(channel, text) {
  const normalized = normalizeSpeech(text);
  if (normalized.length < 6) return false;
  const words = new Set(normalized.split(' '));
  return transcript.slice(-12).some((previous) => {
    if (Date.now() - previous.ts > DUPLICATE_WINDOW_MS) return false;
    const previousNormalized = normalizeSpeech(previous.text);
    if (normalized === previousNormalized) return true;
    const previousWords = new Set(previousNormalized.split(' '));
    if (words.size < 4 || previousWords.size < 4) return false;
    let intersection = 0;
    words.forEach((word) => { if (previousWords.has(word)) intersection += 1; });
    const similarity = intersection / (words.size + previousWords.size - intersection);
    const shorter = Math.min(normalized.length, previousNormalized.length);
    if (channel === previous.channel && shorter >= 18 && (normalized.includes(previousNormalized) || previousNormalized.includes(normalized))) return true;
    return similarity >= (channel === previous.channel ? 0.55 : 0.78);
  });
}
function needsReply(text) {
  const value = String(text || '').trim().toLowerCase();
  return value.includes('?') || /^(what|how|where|when|why|who|which|can you|could you|should|will you|do you)\b/i.test(value) || /\b(please|explain|help|choose|decide|solve|answer|what do you think|how do you think)\b/i.test(value)
    || value.includes('что') || value.includes('как') || value.includes('почему') || value.includes('можешь') || value.includes('подскажи') || value.includes('объясни') || value.includes('помоги') || value.includes('реши');
}

function getCaptureDisplay() {
  if (win && !win.isDestroyed()) return screen.getDisplayMatching(win.getBounds());
  return screen.getPrimaryDisplay();
}

function showWindow() {
  if ((!win || win.isDestroyed()) && app.isReady()) createWindow();
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  updateTrayMenu();
}

function toggleWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isVisible()) win.hide();
  else showWindow();
  updateTrayMenu();
}

async function requestQuit(reason = 'exit') {
  if (!state.capturing) { allowQuit = true; app.quit(); return; }
  const choice = dialog.showMessageBoxSync(win, {
    type: 'warning', buttons: ['Finish and save RAW', 'Stay'], defaultId: 1, cancelId: 1,
    title: 'Cue is recording',
    message: reason === 'shutdown' ? 'Windows is ending the session while Cue is recording.' : 'A meeting recording is active.',
    detail: 'Cue will stop recording and save the available transcript before exiting.'
  });
  if (choice !== 0) return;
  await setCapturing(false, { rawOnly: true });
  if (finalizationPromise) await finalizationPromise;
  allowQuit = true;
  app.quit();
}

function updateTrayMenu() {
  if (!tray) return;
  const visible = !!(win && !win.isDestroyed() && win.isVisible());
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: visible ? 'Скрыть cue' : 'Показать cue', click: toggleWindow },
    { label: 'Настройки', click: () => { showWindow(); send('settings:open'); } },
    { type: 'separator' },
    { label: 'Выйти', click: () => requestQuit() }
  ]));
}

function createTray() {
  if (tray) return;
  const icon = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABIAAAASCAYAAABWzo5XAAAAUklEQVR4nM2TwQoAIAhDXf//z+uc6ZIocFfnc6CadRNUkSQXM5D6UQF4RUAoiG+gqG2QU5rMN+y1WEyT+Z8lGu1A/baGaNrNQeLbi5gAyrdopwlK7E/hnNmM7QAAAABJRU5ErkJggg==')
    .resize({ width: 18, height: 18 });
  tray = new Tray(icon);
  tray.setToolTip('cue');
  tray.on('click', toggleWindow);
  updateTrayMenu();
}

// -------- window --------
function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  // A wide transparent host lets non-modal sidecars sit beside the centered
  // assistant while the empty areas remain click-through.
  const W = Math.min(1600, workArea.width);
  const H = Math.min(720, workArea.height - 12);
  win = new BrowserWindow({
    width: W,
    height: H,
    x: Math.round(workArea.x + (workArea.width - W) / 2),
    y: workArea.y + 6,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  // Invisibility + overlay behavior. Set CUE_NO_PROTECT=1 to disable for debugging.
  win.setContentProtection(!process.env.CUE_NO_PROTECT);            // excluded from screen capture (best-effort)
  if (process.platform === 'darwin') {
    win.setAlwaysOnTop(true, 'screen-saver', 1);
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    if (typeof win.setHiddenInMissionControl === 'function') win.setHiddenInMissionControl(true);
  } else {
    win.setAlwaysOnTop(true);
  }

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  win.webContents.on('did-finish-load', () => {
    win.showInactive();
    if (recoverySessions.length) send('recovery:available', { sessions: recoverySessions });
    for (const message of startupWarnings.splice(0)) send('status', { message });
  });
  win.webContents.on('render-process-gone', (_e, d) => console.log('[cue] renderer gone', JSON.stringify(d)));
  win.on('close', (event) => {
    if (state.capturing && !allowQuit) { event.preventDefault(); void requestQuit(); }
  });
  win.on('query-session-end', (event) => {
    if (state.capturing) { event.preventDefault(); notify('Cue recording active', 'Finish the recording to save the transcript.'); }
  });
  win.on('show', updateTrayMenu);
  win.on('hide', updateTrayMenu);
}

// -------- STT flushing --------
async function flushChannel(channel, options = {}) {
  if (pendingTranscriptions[channel]) return pendingTranscriptions[channel];
  const chunks = buffers[channel];
  if (!chunks.length) return;
  const generation = options.generation === undefined ? captureGeneration : options.generation;
  const allowStopped = options.allowStopped === true;
  const allowShort = options.allowShort === true;
  const pcm = Buffer.concat(chunks);
  buffers[channel] = [];
  if (pcm.length < MIN_BYTES && !allowShort) return;
  if (rms16(pcm) < RMS_GATE) return; // silence gate

  state.transcribing[channel] = true;
  const task = (async () => {
    try {
      const settings = store.getSettings();
      const stt = createSTT(settings);
      if (!stt.available) {
        if (!sttDisabled) { sttDisabled = true; send('status', { message: stt.error || 'No transcription route is ready. Add a speech-to-text key in Settings. Screen features work without it.' }); }
        return;
      }
      sendDiagnostics({ stt: 'working', queued: Object.values(pendingTranscriptions).filter(Boolean).length });
      const res = await stt.transcribe(pcm);
      if (res.error) {
        sendDiagnostics({ stt: 'error', sttError: res.error.message });
        if (generation === captureGeneration && (state.capturing || allowStopped)) handleSttError(res.error, settings);
        return;
      }
      if ((!state.capturing && !allowStopped) || generation !== captureGeneration) return;
      const text = res.text && res.text.trim();
      sendDiagnostics({ stt: 'ok', sttProvider: res.provider || null });
      if (text && !isDuplicateTurn(channel, text)) {
        for (const turn of parseSpeakerTurns(channel, text)) {
        try {
          await sessionJournal.appendTurn(turn);
          sendDiagnostics({ disk: 'ok' });
        } catch (error) {
          sendDiagnostics({ disk: 'error', diskError: error.message });
          await sessionJournal.appendError(error, 'journal-write').catch(() => {});
        }
        transcript.push(turn);
        if (DEBUG) console.log(`[TRANSCRIPT] ${channel === 'you' ? 'You' : 'Them'}:`, turn.text);
        send('transcript', turn);
        }
        if (channel === 'them' && needsReply(text)) scheduleAutoAssist();
      }
    } catch (e) {
      console.log('[stt] error', e && e.message);
      await sessionJournal.appendError(e, 'stt-unhandled').catch(() => {});
    }
  })();
  pendingTranscriptions[channel] = task;
  try {
    await task;
  } finally {
    if (pendingTranscriptions[channel] === task) pendingTranscriptions[channel] = null;
    state.transcribing[channel] = false;
  }
}

async function waitForTranscriptions() {
  const pending = Object.values(pendingTranscriptions).filter(Boolean);
  if (pending.length) await Promise.all(pending);
}

function scheduleAutoAssist() {
  clearTimeout(assistTimer);
  if (!assistActive || !state.capturing) return;
  assistTimer = setTimeout(() => {
    assistTimer = null;
    if (!assistActive || !state.capturing || transcript.length <= assistTurnCount) return;
    if (state.busy) { assistQueued = true; return; }
    assistTurnCount = transcript.length;
    runFeature('assist', '');
  }, ASSIST_IDLE_MS);
}

function setAssistActive(active) {
  assistActive = !!active;
  assistQueued = false;
  clearTimeout(assistTimer);
  assistTimer = null;
  assistTurnCount = transcript.length;
  send('status', { message: assistActive ? 'Помощь в реальном времени включена.' : 'Помощь в реальном времени выключена.' });
  if (assistActive) scheduleAutoAssist();
  return assistActive;
}

async function ensureRawTranscript(reason) {
  if (sessionJournal.data && sessionJournal.data.rawFile) return { filePath: sessionJournal.data.rawFile, fileName: path.basename(sessionJournal.data.rawFile) };
  const raw = await saveTranscriptFallback({ outputDirectory: CUE_DOCUMENTS_DIRECTORY, transcript: [...transcript], reason });
  await sessionJournal.mark(sessionJournal.data && sessionJournal.data.status || 'finalizing', { rawFile: raw.filePath });
  sendDiagnostics({ disk: 'ok' });
  return raw;
}

async function finalizeCapture(generation, options = {}) {
  try {
    await new Promise((resolve) => setTimeout(resolve, STOP_DRAIN_MS));
    await waitForTranscriptions();
    if (state.capturing || generation !== captureGeneration) return;

    let finalScreenImage = null;
    try { finalScreenImage = await captureScreenshot(getCaptureDisplay()); }
    catch (error) { console.log('[recap] screen capture unavailable', error && error.message); }

    await Promise.all([
      flushChannel('you', { generation, allowStopped: true, allowShort: true }),
      flushChannel('them', { generation, allowStopped: true, allowShort: true })
    ]);
    if (state.capturing || generation !== captureGeneration) return;

    if (!transcript.length && !finalScreenImage) {
      send('status', { message: 'Не удалось распознать речь для итогов созвона.' });
      return;
    }
    const raw = await ensureRawTranscript(options.rawOnly ? 'Запись завершена без AI-итога.' : 'Сохранено автоматически до генерации AI-итога.');
    if (options.rawOnly) {
      await sessionJournal.mark('completed', { rawFile: raw.filePath, completedAt: new Date().toISOString() });
      send('status', { message: `Сырая расшифровка сохранена: ${raw.fileName}` });
      openRecapInMarkEdit(raw.filePath);
      notify('Cue: запись сохранена', `${transcript.length} реплик · ${sessionJournal.data && sessionJournal.data.errors ? sessionJournal.data.errors.length : 0} ошибок\nRAW: ${raw.filePath}`, raw.filePath);
      return;
    }
    send('status', { message: `RAW сохранён: ${raw.fileName}. Готовлю AI-итог...` });
    send('status', { message: 'Транскрипция готова. Готовлю итог созвона...' });
    await runFeature('recap', '', { imageDataUrl: finalScreenImage });
  } finally {
    if (finalizingGeneration === generation) finalizingGeneration = null;
  }
}

function handleSttError(err, settings) {
  console.log('[stt] error', err.provider, err.status, err.code, err.message);
  sessionJournal.appendError(err, 'stt').catch(() => {});
  if (sttDisabled) return;
  const noAccess = err.status === 403 || err.status === 401 || err.code === 'model_not_found';
  sttDisabled = noAccess;
  if (noAccess) {
    send('status', { message: 'Transcription off: your ' + err.provider + ' key has no access to a speech-to-text model (403). Screen + LeetCode still work. To enable listening: give the key Whisper/transcription access, or add a Gemini key in Settings and reopen.' });
  } else {
    send('status', { message: 'Временная ошибка расшифровки (' + err.provider + '): ' + err.message + '. Следующий фрагмент будет обработан повторно.' });
  }
}

function startFlushLoop() {
  if (flushTimer) return;
  flushTimer = setInterval(() => { flushChannel('you'); flushChannel('them'); }, FLUSH_MS);
}
function stopFlushLoop() { if (flushTimer) { clearInterval(flushTimer); flushTimer = null; } }

function openRecapInMarkEdit(filePath) {
  // MarkEdit is macOS-only. On Windows use the user's default Markdown reader.
  shell.openPath(filePath).catch((error) => console.log('[recap] open error', error && error.message));
}

// -------- capture toggle --------
// Mic + system audio are both captured in the RENDERER (getUserMedia for the mic,
// getDisplayMedia loopback for system audio) so they run inside cue's own process
// and use cue's own Screen-Recording grant — no separate helper binary to authorize.
async function setCapturing(active, options = {}) {
  state.capturing = active;
  if (active) captureGeneration += 1;
  const stoppedGeneration = active ? null : captureGeneration;
  if (active) {
    if (powerBlockerId === null) powerBlockerId = powerSaveBlocker.start('prevent-app-suspension');
    finalizingGeneration = null;
    sttDisabled = false;
    if (!options.resume) {
      transcript.length = 0;
      await sessionJournal.start();
    } else {
      await sessionJournal.mark('recording');
    }
    sendDiagnostics({ disk: 'ok', stt: 'idle', queued: 0 });
    buffers.you = []; buffers.them = [];
    assistTurnCount = 0;
    assistQueued = false;
    startFlushLoop();
  } else {
    if (powerBlockerId !== null && powerSaveBlocker.isStarted(powerBlockerId)) powerSaveBlocker.stop(powerBlockerId);
    powerBlockerId = null;
    await sessionJournal.mark('finalizing');
    finalizingGeneration = stoppedGeneration;
    clearTimeout(assistTimer);
    assistTimer = null;
    assistQueued = false;
    stopFlushLoop();
  }
  send('capture:state', { active });
  if (stoppedGeneration !== null) {
    send('status', { message: 'Запись остановлена. Догружаю последние фразы...' });
    finalizationPromise = finalizeCapture(stoppedGeneration, options).catch(async (e) => {
      console.log('[recap] error', e && e.message);
      await sessionJournal.appendError(e, 'finalize').catch(() => {});
      await sessionJournal.mark('failed').catch(() => {});
    }).finally(() => { finalizationPromise = null; });
  }
  return active;
}

// -------- feature runner --------
async function runFeature(mode, userText, options = {}) {
  if (DEBUG) console.log('[DEBUG MAIN] runFeature called:', { mode, userText, isBusy: state.busy });
  if (state.busy) return;
  const def = MODES[mode];
  if (!def) {
    if (DEBUG) console.log('[DEBUG MAIN] mode not found:', mode);
    return;
  }
  state.busy = true;
  try {
    const settings = store.getSettings();
    const llm = createLLM(settings, { fast: mode === 'assist', maxTokens: mode === 'assist' ? 450 : undefined });
    const language = settings.appearance && settings.appearance.language === 'en' ? 'en' : 'ru';
    const userBubble = def.userBubble !== null
      ? (mode === 'ask' ? userText : (language === 'ru' && def.userBubbleRu ? def.userBubbleRu : def.userBubble))
      : null;
    if (DEBUG) console.log('[DEBUG MAIN] LLM settings loaded:', { provider: settings.provider, smart: settings.smart });
    const appendResponse = (mode === 'assist' && assistActive) || mode === 'recap';
    send('llm:start', { userBubble, small: !!def.small, append: appendResponse, responseLabel: mode === 'recap' ? 'Итог' : 'Помощь' });

    if (!llm.ready) {
      if (DEBUG) console.log('[DEBUG MAIN] LLM not ready (missing key or model).');
      send('llm:error', { message: llm.error || ('Add your ' + settings.provider + ' API key in Settings (gear icon) to start. Model: ' + (llm.model || 'unset') + '.') });
      return;
    }

    let imageDataUrl = options.imageDataUrl || null;
    if (def.needsScreen && (options.imageDataUrl || shouldCaptureScreen(mode, userText))) {
      if (!imageDataUrl && !state.capturing && !def.screenOptional) {
        send('llm:error', { message: 'Сначала включите запись, чтобы cue получил доступ к экрану.' });
        return;
      }
      if (!imageDataUrl && state.capturing) {
      if (DEBUG) console.log('[DEBUG MAIN] Feature needs screen. Capturing screenshot...');
      try {
        imageDataUrl = await captureScreenshot(getCaptureDisplay());
        if (!imageDataUrl) throw new Error('No display source was returned.');
        if (DEBUG) console.log('[DEBUG MAIN] Screenshot captured successfully (length:', imageDataUrl.length, ')');
      }
      catch (e) {
        if (DEBUG) console.error('[DEBUG MAIN] Screenshot capture failed:', e);
        const detail = e && e.message ? ' ' + e.message : '';
        const message = process.platform === 'darwin'
          ? 'Screen capture needs permission — grant Screen Recording to cue in System Settings.'
          : 'Screen capture failed. Restart cue and try again.' + detail;
        send('status', { message });
      }
      }
    }

    const built = def.build({ transcript, userText: userText || '' });
    if (DEBUG) console.log('[DEBUG MAIN] Built prompt. Starting LLM stream...');
    const languageInstruction = language === 'ru'
      ? '\nRespond in Russian unless the user explicitly asks for another language.'
      : '\nRespond in English unless the user explicitly asks for another language.';
    const fullText = await llm.stream({
      system: def.system + languageInstruction,
      turns: [{ role: 'user', text: built }],
      imageDataUrl,
      onToken: (t) => send('llm:token', { text: t })
    });
    if (DEBUG) console.log('[DEBUG MAIN] Full LLM Output:\n', fullText);
    const suppress = mode === 'assist' && /^NO_ACTION[.!]?$/i.test(String(fullText || '').trim());
    let savedRecap = null;
    if (mode === 'recap' && fullText && String(fullText).trim()) {
      try {
        savedRecap = await saveRecap({ outputDirectory: CUE_DOCUMENTS_DIRECTORY, summary: fullText, transcript: [...transcript] });
        await sessionJournal.mark('completed', { recapFile: savedRecap.filePath, completedAt: new Date().toISOString() });
        send('status', { message: `Итог сохранён: ${savedRecap.fileName}` });
        openRecapInMarkEdit(savedRecap.filePath);
        notify('Cue: встреча завершена', `${transcript.length} реплик · ${sessionJournal.data && sessionJournal.data.errors ? sessionJournal.data.errors.length : 0} ошибок\nRAW и итог сохранены`, savedRecap.filePath);
      } catch (error) {
        console.log('[recap] save error', error && error.message);
        await sessionJournal.appendError(error, 'recap-save').catch(() => {});
        await sessionJournal.mark('failed').catch(() => {});
        send('status', { message: 'Итог готов, но не удалось сохранить Markdown-файл.' });
      }
    }
    send('llm:done', { suppress, recapFile: savedRecap && savedRecap.filePath });
  } catch (e) {
    if (mode === 'recap') {
      await sessionJournal.appendError(e, 'recap-generation').catch(() => {});
      await sessionJournal.mark('failed').catch(() => {});
    }
    send('llm:error', { message: 'Error: ' + (e && e.message ? e.message : String(e)) });
  } finally {
    state.busy = false;
    if (mode === 'assist' && assistActive && state.capturing && assistQueued) {
      assistQueued = false;
      scheduleAutoAssist();
    }
  }
}

// -------- IPC --------
ipcMain.handle('settings:get', () => store.getSettings());
ipcMain.handle('settings:set', (_e, patch) => { sttDisabled = false; return store.setSettings(patch); });
ipcMain.handle('assist:toggle', () => setAssistActive(!assistActive));
ipcMain.handle('capture:toggle', () => setCapturing(!state.capturing));
ipcMain.handle('capture:finish-raw', () => state.capturing ? setCapturing(false, { rawOnly: true }) : ensureRawTranscript('Сохранено вручную без AI-итога.'));
ipcMain.handle('capture:state', () => ({ active: state.capturing }));
ipcMain.handle('sessions:list', () => sessionJournal.listIncomplete());
ipcMain.handle('sessions:dismiss', async (_e, filePath) => {
  await sessionJournal.dismiss(filePath);
  recoverySessions = await sessionJournal.listIncomplete();
  send('recovery:available', { sessions: recoverySessions });
  return recoverySessions;
});
ipcMain.handle('sessions:open', async (_e, filePath) => {
  const loaded = await sessionJournal.load(filePath);
  transcript.length = 0;
  transcript.push(...loaded.data.transcript);
  const raw = await ensureRawTranscript('Восстановлено из незавершённой сессии.');
  return shell.openPath(raw.filePath);
});
ipcMain.handle('sessions:summary', async (_e, filePath) => {
  const loaded = await sessionJournal.load(filePath);
  transcript.length = 0;
  transcript.push(...loaded.data.transcript);
  send('session:loaded', { transcript: [...transcript] });
  await runFeature('recap', '');
  recoverySessions = await sessionJournal.listIncomplete();
  send('recovery:available', { sessions: recoverySessions });
  return true;
});
ipcMain.handle('sessions:continue', async (_e, filePath) => {
  const loaded = await sessionJournal.load(filePath);
  transcript.length = 0;
  transcript.push(...loaded.data.transcript);
  await setCapturing(true, { resume: true });
  send('session:loaded', { transcript: [...transcript] });
  return true;
});
ipcMain.handle('catalog:search', (_e, query) => searchCatalog(CUE_DOCUMENTS_DIRECTORY, query));
ipcMain.handle('catalog:open', async (_e, filePath) => {
  const item = (await buildCatalog(CUE_DOCUMENTS_DIRECTORY)).find((entry) => entry.filePath === path.resolve(filePath));
  if (!item) throw new Error('Meeting file is outside the Cue catalog.');
  return shell.openPath(item.filePath);
});
ipcMain.handle('catalog:export', async (_e, filePath, format) => {
  const item = (await buildCatalog(CUE_DOCUMENTS_DIRECTORY)).find((entry) => entry.filePath === path.resolve(filePath));
  if (!item) throw new Error('Meeting file is outside the Cue catalog.');
  const outputPath = format === 'pdf' ? await exportPdf(item.filePath) : await exportDocx(item.filePath);
  notify('Cue: экспорт готов', outputPath, outputPath);
  return outputPath;
});
ipcMain.handle('catalog:extract', async (_e, filePath, kind) => {
  const item = (await buildCatalog(CUE_DOCUMENTS_DIRECTORY)).find((entry) => entry.filePath === path.resolve(filePath));
  if (!item) throw new Error('Meeting file is outside the Cue catalog.');
  return kind === 'decisions' ? item.decisions : item.tasks;
});
ipcMain.on('ask', (_e, payload) => runFeature(payload.mode, payload.text));
ipcMain.on('mic:pcm', (_e, arrayBuffer) => { if (state.capturing || finalizingGeneration === captureGeneration) buffers.you.push(Buffer.from(arrayBuffer)); });
ipcMain.on('system:pcm', (_e, arrayBuffer) => { if (state.capturing || finalizingGeneration === captureGeneration) buffers.them.push(Buffer.from(arrayBuffer)); });
ipcMain.on('mouse:ignore', (_e, v) => { if (win) win.setIgnoreMouseEvents(!!v, { forward: true }); });
ipcMain.on('open-pane', (_e, url) => { shell.openExternal(url).catch(() => {}); });
ipcMain.on('settings:open', () => send('settings:open'));
ipcMain.on('window:hide-to-tray', () => { if (win && !win.isDestroyed()) { win.hide(); updateTrayMenu(); } });
ipcMain.on('log', (_e, msg) => console.log('[renderer]', msg));

// -------- shortcuts --------
function registerShortcuts() {
  const shortcuts = [
    ['CommandOrControl+Return', () => runFeature('assist', '')],
    ['CommandOrControl+H', () => runFeature('leetcode', '')],
    ['CommandOrControl+Shift+T', toggleWindow],
    ['CommandOrControl+Shift+X', () => requestQuit()]
  ];
  for (const [accelerator, handler] of shortcuts) {
    if (!globalShortcut.register(accelerator, handler)) {
      startupWarnings.push('Global shortcut ' + accelerator + ' is already used by another app.');
    }
  }
}

// -------- lifecycle --------
if (hasSingleInstanceLock) app.on('second-instance', showWindow);

if (hasSingleInstanceLock) app.whenReady().then(async () => {
  if (app.dock) app.dock.hide();
  enableAutoLaunch();

  const allowMedia = (permission) => permission === 'media' || permission === 'microphone' || permission === 'audioCapture' || permission === 'display-capture';
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(allowMedia(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowMedia(permission));

  // System-audio loopback for getDisplayMedia: hand back a screen source with 'loopback'
  // audio so the renderer can capture what's playing (Zoom/Meet) using cue's own grant.
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    const display = getCaptureDisplay();
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      const source = sources.find((item) => String(item.display_id) === String(display.id)) || sources[0];
      if (source) callback({ video: source, audio: 'loopback' });
      else callback();
    }).catch(() => callback());
  }, { useSystemPicker: false });

  recoverySessions = await sessionJournal.listIncomplete().catch((error) => {
    startupWarnings.push('Не удалось проверить незавершённые встречи: ' + error.message);
    return [];
  });

  createWindow();
  if (process.platform === 'win32') createTray();
  registerShortcuts();

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (tray) { tray.destroy(); tray = null; }
});
app.on('before-quit', (event) => {
  if (state.capturing && !allowQuit) { event.preventDefault(); void requestQuit(); }
});
app.on('window-all-closed', () => app.quit());
