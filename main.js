const DEBUG = false; // Set to false to disable debug logging
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, globalShortcut, screen, session, desktopCapturer, shell, Notification, dialog, powerSaveBlocker } = require('electron');
const path = require('path');
const store = require('./src/store');
const { captureScreenshot } = require('./src/screen');
const { createSTT } = require('./src/stt');
const { LocalSTT, setupLocalSTT } = require('./src/local-stt');
const { SpeechBuffer } = require('./src/speech-buffer');
const { createLLM } = require('./src/llm');
const { MODES } = require('./src/prompts');
const { rms16 } = require('./src/wav');
const { saveRecap, saveTranscriptFallback } = require('./src/recap-export');
const { SessionJournal } = require('./src/session-journal');
const { searchCatalog, buildCatalog } = require('./src/meeting-catalog');
const { exportDocx, exportPdf } = require('./src/meeting-export');

const CUE_DOCUMENTS_DIRECTORY = process.env.CUE_DOCUMENTS_DIR || (process.platform === 'win32'
  ? 'A:\\Cue Documents'
  : path.join(app.getPath('documents'), 'Cue Documents'));

let win = null;
let tray = null;
const startupWarnings = [];
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) app.quit();

// -------- capture / transcript state --------
const state = { capturing: false, busy: false, transcribing: { you: false, them: false } };
let sttDisabled = false; // set when the key can't reach any speech model (stops retry spam)
const buffers = { you: new SpeechBuffer(), them: new SpeechBuffer() };
const transcript = []; // { channel, text, ts }
const chatHistory = [];
const localSTT = new LocalSTT({ root: path.join(app.getPath('userData'), 'gigaam') });
let localSetupPromise = null;
let captureTransition = false;
let featurePromise = null;
const sessionJournal = new SessionJournal(CUE_DOCUMENTS_DIRECTORY);
let recoverySessions = [];
let powerBlockerId = null;
let allowQuit = false;
const FLUSH_MS = 2200;
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
  if (mode === 'recap') return false;
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
  if (!state.capturing) { if (finalizationPromise) await finalizationPromise; allowQuit = true; app.quit(); return; }
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
  const H = workArea.height - 12;
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
  const settings = store.getSettings();
  const chunk = buffers[channel].take({ force: options.allowShort === true, live: settings.stt.mode === 'local' });
  if (!chunk) return;
  const generation = options.generation === undefined ? captureGeneration : options.generation;
  const allowStopped = options.allowStopped === true;
  const { pcm, ts } = chunk;
  if (rms16(pcm) < RMS_GATE) return; // silence gate

  state.transcribing[channel] = true;
  const task = (async () => {
    try {
      const stt = createSTT(settings, { localSTT });
      if (!stt.available) {
        if (!sttDisabled) { sttDisabled = true; send('status', { message: stt.error || 'No transcription route is ready. Add a speech-to-text key in Settings. Screen features work without it.' }); }
        return;
      }
      sendDiagnostics({ stt: 'working', queued: Object.values(pendingTranscriptions).filter(Boolean).length });
      let res = await stt.transcribe(pcm);
      if (res.error && settings.stt.mode === 'local') {
        sendDiagnostics({ stt: 'working', sttError: 'Повторяю локальное распознавание фрагмента.' });
        res = await stt.transcribe(pcm);
      }
      if (res.error) {
        sendDiagnostics({ stt: 'error', sttError: res.error.message });
        if (generation === captureGeneration && (state.capturing || allowStopped || finalizingGeneration === generation)) handleSttError(res.error, settings);
        return;
      }
      if ((!state.capturing && !allowStopped && finalizingGeneration !== generation) || generation !== captureGeneration) return;
      const text = res.text && res.text.trim();
      sendDiagnostics({ stt: 'ok', sttProvider: res.provider || null });
      if (text && !isDuplicateTurn(channel, text)) {
        for (const turn of parseSpeakerTurns(channel, text)) {
        turn.ts = ts;
        try {
          await sessionJournal.appendTurn(turn);
          sendDiagnostics({ disk: 'ok' });
        } catch (error) {
          sendDiagnostics({ disk: 'error', diskError: error.message });
          await sessionJournal.appendError(error, 'journal-write').catch(() => {});
        }
        transcript.push(turn);
        transcript.sort((a, b) => a.ts - b.ts);
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
    runFeature('auto', '');
  }, ASSIST_IDLE_MS);
}

function setAssistActive(active) {
  assistActive = !!active;
  assistQueued = false;
  clearTimeout(assistTimer);
  assistTimer = null;
  assistTurnCount = active ? Math.max(0, transcript.length - 1) : transcript.length;
  send('status', { message: assistActive ? 'Помощь в реальном времени включена.' : 'Помощь в реальном времени выключена.' });
  if (assistActive) scheduleAutoAssist();
  return assistActive;
}

async function ensureRawTranscript(reason) {
  if (sessionJournal.data && sessionJournal.data.rawFile && sessionJournal.data.rawTurnCount === transcript.length) return { filePath: sessionJournal.data.rawFile, fileName: path.basename(sessionJournal.data.rawFile) };
  const raw = await saveTranscriptFallback({ outputDirectory: CUE_DOCUMENTS_DIRECTORY, transcript: [...transcript], reason });
  await sessionJournal.mark(sessionJournal.data && sessionJournal.data.status || 'finalizing', { rawFile: raw.filePath, rawTurnCount: transcript.length });
  sendDiagnostics({ disk: 'ok' });
  return raw;
}

async function finalizeCapture(generation, options = {}) {
  try {
    await new Promise((resolve) => setTimeout(resolve, STOP_DRAIN_MS));
    await waitForTranscriptions();
    if (state.capturing || generation !== captureGeneration) return;

    while (buffers.you.bytes || buffers.them.bytes) {
      await Promise.all([
        flushChannel('you', { generation, allowStopped: true, allowShort: true }),
        flushChannel('them', { generation, allowStopped: true, allowShort: true })
      ]);
    }
    if (state.capturing || generation !== captureGeneration) return;

    if (!transcript.length) {
      await sessionJournal.mark('failed');
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
    if (featurePromise) await featurePromise;
    await runFeature('recap', '', { final: true });
  } finally {
    if (finalizingGeneration === generation) finalizingGeneration = null;
    await refreshRecovery();
  }
}

async function refreshRecovery() {
  recoverySessions = await sessionJournal.listIncomplete().catch(() => []);
  send('recovery:available', { sessions: recoverySessions });
}

function handleSttError(err, settings) {
  console.log('[stt] error', err.provider, err.status, err.code, err.message);
  sessionJournal.appendError(err, 'stt').catch(() => {});
  if (err.provider === 'local-gigaam') {
    send('status', { message: 'Фрагмент не распознан локальной GigaAM: ' + err.message + ' Аудио не отправлено через API. Запись остановлена.' });
    if (state.capturing) void setCapturing(false, { rawOnly: true }).catch(() => {});
    return;
  }
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
  flushTimer = setInterval(() => { flushChannel('you'); flushChannel('them'); }, store.getSettings().stt.mode === 'local' ? 200 : FLUSH_MS);
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
  if (captureTransition) throw new Error('Дождитесь запуска записи.');
  if (active && (finalizationPromise || state.busy)) throw new Error('Дождитесь ответа или сохранения предыдущей встречи.');
  if (active && localSetupPromise) throw new Error('Дождитесь установки GigaAM.');
  captureTransition = true;
  try {
    if (active && store.getSettings().stt.mode === 'local') {
      send('status', { message: 'Загружаю локальную GigaAM…' });
      await localSTT.prepare(store.getSettings().stt.local);
    }
    state.capturing = active;
    if (active) captureGeneration += 1;
    const stoppedGeneration = active ? null : captureGeneration;
    if (active) {
      if (powerBlockerId === null) powerBlockerId = powerSaveBlocker.start('prevent-app-suspension');
      finalizingGeneration = null;
      sttDisabled = false;
      if (!options.resume) {
        transcript.length = 0;
        chatHistory.length = 0;
        await sessionJournal.start();
      } else {
        await sessionJournal.mark('recording', { recapFile: null, completedAt: null });
      }
      sendDiagnostics({ disk: 'ok', stt: 'idle', queued: 0 });
      buffers.you.clear(); buffers.them.clear();
      assistTurnCount = 0;
      assistQueued = false;
      startFlushLoop();
    } else {
      finalizingGeneration = stoppedGeneration;
      stopFlushLoop();
      if (powerBlockerId !== null && powerSaveBlocker.isStarted(powerBlockerId)) powerSaveBlocker.stop(powerBlockerId);
      powerBlockerId = null;
      clearTimeout(assistTimer);
      assistTimer = null;
      assistQueued = false;
      await sessionJournal.mark('finalizing').catch((error) => {
        sendDiagnostics({ disk: 'error', diskError: error.message });
      });
    }
    send('capture:state', { active });
    if (stoppedGeneration !== null) {
      send('status', { message: 'Запись остановлена. Догружаю последние фразы...' });
      finalizationPromise = finalizeCapture(stoppedGeneration, options).catch(async (e) => {
        console.log('[recap] error', e && e.message);
        await sessionJournal.appendError(e, 'finalize').catch(() => {});
        await sessionJournal.mark('failed').catch(() => {});
        send('llm:error', { message: 'Не удалось завершить сохранение: ' + e.message + '. Расшифровку можно восстановить в блоке незавершённых встреч.' });
        await refreshRecovery();
      }).finally(() => { finalizationPromise = null; });
    }
    return active;
  } catch (error) {
    if (active) {
      state.capturing = false;
      stopFlushLoop();
      if (powerBlockerId !== null && powerSaveBlocker.isStarted(powerBlockerId)) powerSaveBlocker.stop(powerBlockerId);
      powerBlockerId = null;
      send('capture:state', { active: false });
    }
    throw error;
  } finally { captureTransition = false; }
}

// -------- feature runner --------
function runFeature(mode, userText, options = {}) {
  if (!MODES[mode]) { send('llm:error', { message: 'Неизвестное действие.' }); return Promise.resolve(); }
  if (finalizationPromise && !options.final) {
    send('status', { message: 'Дождитесь сохранения итогов встречи.' });
    if (!state.busy) send('llm:done', { suppress: true });
    return Promise.resolve();
  }
  if (state.busy) return featurePromise || Promise.resolve();
  featurePromise = performFeature(mode, userText, options).finally(() => { featurePromise = null; });
  return featurePromise;
}

async function performFeature(mode, userText, options = {}) {
  if (DEBUG) console.log('[DEBUG MAIN] runFeature called:', { mode, userText, isBusy: state.busy });
  if (state.busy) return;
  const def = MODES[mode];
  if (!def) {
    if (DEBUG) console.log('[DEBUG MAIN] mode not found:', mode);
    return;
  }
  state.busy = true;
  const saveFinal = mode === 'recap' && !state.capturing;
  try {
    const settings = store.getSettings();
    const llm = createLLM(settings, { fast: mode === 'auto' });
    const language = settings.appearance && settings.appearance.language === 'en' ? 'en' : 'ru';
    const userBubble = userText || (language === 'ru' && def.userBubbleRu ? def.userBubbleRu : def.userBubble);
    if (DEBUG) console.log('[DEBUG MAIN] LLM settings loaded:', { provider: settings.provider, smart: settings.smart });
    const appendResponse = true;
    send('llm:start', { userBubble, small: !!def.small, append: appendResponse, responseLabel: mode === 'recap' ? 'Итог' : 'Помощь' });

    if (!llm.ready) {
      if (DEBUG) console.log('[DEBUG MAIN] LLM not ready (missing key or model).');
      throw new Error(llm.error || 'Настройте модель и API-ключ.');
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

    if (state.capturing && mode !== 'leetcode') {
      await waitForTranscriptions();
      await Promise.all(['you', 'them'].map((channel) => flushChannel(channel, { allowShort: true })));
    }
    if (def.needsScreen && !def.screenOptional && !imageDataUrl) throw new Error('Не удалось получить экран с задачей.');
    const snapshot = transcript.map((turn) => ({ ...turn }));
    if (mode === 'recap' && !snapshot.length) throw new Error('Пока нет распознанных реплик для резюме.');
    if (saveFinal) await ensureRawTranscript('Сохранено перед генерацией AI-итога.');
    const built = def.build({ transcript: snapshot, userText: userText || '' });
    if (DEBUG) console.log('[DEBUG MAIN] Built prompt. Starting LLM stream...');
    const languageInstruction = language === 'ru'
      ? '\nRespond in Russian unless the user explicitly asks for another language.'
      : '\nRespond in English unless the user explicitly asks for another language.';
    const fullText = await llm.stream({
      system: def.system + languageInstruction,
      turns: [...(mode === 'ask' || (userText && ['say', 'assist', 'followup'].includes(mode)) ? chatHistory.slice(-12) : []), { role: 'user', text: built }],
      imageDataUrl,
      onToken: (t) => { if (mode !== 'auto') send('llm:token', { text: t }); }
    });
    if (DEBUG) console.log('[DEBUG MAIN] Full LLM Output:\n', fullText);
    if (!String(fullText || '').trim()) throw new Error('Модель вернула пустой ответ. Повторите запрос.');
    const suppress = mode === 'auto' && /^NO_ACTION[.!]?$/i.test(String(fullText || '').trim());
    if (mode === 'auto' && !suppress) send('llm:token', { text: fullText });
    if (!suppress && mode !== 'recap' && fullText) {
      chatHistory.push({ role: 'user', text: userText || userBubble || 'Предложи ответ на последнюю реплику собеседника.' }, { role: 'assistant', text: fullText });
      if (chatHistory.length > 24) chatHistory.splice(0, chatHistory.length - 24);
    }
    let savedRecap = null;
    if (saveFinal) {
      try {
        savedRecap = await saveRecap({ outputDirectory: CUE_DOCUMENTS_DIRECTORY, summary: fullText, transcript: snapshot });
        await sessionJournal.mark('completed', { recapFile: savedRecap.filePath, completedAt: new Date().toISOString() });
        send('status', { message: `Итог сохранён: ${savedRecap.fileName}` });
        openRecapInMarkEdit(savedRecap.filePath);
        notify('Cue: встреча завершена', `${transcript.length} реплик · ${sessionJournal.data && sessionJournal.data.errors ? sessionJournal.data.errors.length : 0} ошибок\nRAW и итог сохранены`, savedRecap.filePath);
      } catch (error) {
        console.log('[recap] save error', error && error.message);
        await sessionJournal.appendError(error, 'recap-save').catch(() => {});
        await sessionJournal.mark('failed').catch(() => {});
        send('status', { message: 'Итог готов в чате, но не удалось сохранить Markdown-файл: ' + error.message });
      }
    }
    send('llm:done', { suppress, recapFile: savedRecap && savedRecap.filePath });
  } catch (e) {
    if (saveFinal) {
      await sessionJournal.appendError(e, 'recap-generation').catch(() => {});
      await sessionJournal.mark('failed').catch(() => {});
    }
    const detail = e.status === 503 ? 'Сервис модели временно недоступен (503).' : (e && e.message ? e.message : String(e));
    send('llm:error', { message: detail + (saveFinal ? ' Итог не сформирован. RAW сохранён, если запись на диск была доступна. Повторите через «Итог» в незавершённых встречах.' : '') });
  } finally {
    state.busy = false;
    if (saveFinal) await refreshRecovery();
    if (assistActive && state.capturing && assistQueued) {
      assistQueued = false;
      scheduleAutoAssist();
    }
  }
}

// -------- IPC --------
ipcMain.handle('settings:get', () => store.getSettings());
ipcMain.handle('settings:set', (_e, patch) => {
  if (patch.stt && JSON.stringify(patch.stt) !== JSON.stringify(store.getSettings().stt) && (state.capturing || finalizationPromise || captureTransition)) {
    throw new Error('Завершите запись перед сменой расшифровки.');
  }
  sttDisabled = false;
  return store.setSettings(patch);
});
ipcMain.handle('local-stt:check', async (_e, config) => {
  if (state.capturing || finalizationPromise || captureTransition || localSetupPromise) throw new Error('Дождитесь завершения записи или установки.');
  return localSTT.prepare(config);
});
ipcMain.handle('local-stt:folder', async () => {
  const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: 'Папка GigaAM v3 E2E RNN-T' });
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle('local-stt:setup', async () => {
  if (state.capturing || finalizationPromise || captureTransition) throw new Error('Завершите запись перед установкой GigaAM.');
  if (!localSetupPromise) {
    localSTT.stop();
    localSetupPromise = setupLocalSTT(localSTT.root, (message) => send('local-stt:progress', { message }))
      .then(async (config) => { await localSTT.prepare(config); return config; })
      .finally(() => { localSetupPromise = null; });
  }
  return localSetupPromise;
});
ipcMain.handle('assist:toggle', () => setAssistActive(!assistActive));
ipcMain.handle('capture:toggle', () => setCapturing(!state.capturing));
ipcMain.handle('capture:finish-raw', async () => {
  if (finalizationPromise) { await finalizationPromise; return; }
  if (state.capturing) return setCapturing(false, { rawOnly: true });
  if (!transcript.length) throw new Error('Пока нет распознанных реплик для сохранения.');
  const raw = await ensureRawTranscript('Сохранено вручную без AI-итога.');
  send('status', { message: `RAW сохранён: ${raw.fileName}` });
  openRecapInMarkEdit(raw.filePath);
  return raw;
});
ipcMain.handle('capture:state', () => ({ active: state.capturing }));
ipcMain.handle('sessions:list', () => sessionJournal.listIncomplete());
ipcMain.handle('sessions:dismiss', async (_e, filePath) => {
  await sessionJournal.dismiss(filePath);
  recoverySessions = await sessionJournal.listIncomplete();
  send('recovery:available', { sessions: recoverySessions });
  return recoverySessions;
});
ipcMain.handle('sessions:open', async (_e, filePath) => {
  if (state.capturing || finalizationPromise || state.busy || captureTransition) throw new Error('Завершите текущую встречу перед открытием другой.');
  chatHistory.length = 0;
  const loaded = await sessionJournal.load(filePath);
  transcript.length = 0;
  transcript.push(...loaded.data.transcript);
  const raw = await ensureRawTranscript('Восстановлено из незавершённой сессии.');
  return shell.openPath(raw.filePath);
});
ipcMain.handle('sessions:summary', async (_e, filePath) => {
  if (state.capturing || finalizationPromise || state.busy || captureTransition) throw new Error('Завершите текущую встречу перед открытием другой.');
  chatHistory.length = 0;
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
  if (state.capturing || finalizationPromise || state.busy || captureTransition) throw new Error('Завершите текущую встречу перед открытием другой.');
  chatHistory.length = 0;
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
function acceptPcm(channel, arrayBuffer) {
  if (!(state.capturing || finalizingGeneration === captureGeneration)) return;
  try { buffers[channel].push(Buffer.from(arrayBuffer)); }
  catch (error) {
    send('status', { message: error.message });
    sessionJournal.appendError(error, 'audio-backlog').catch(() => {});
    if (state.capturing) void setCapturing(false, { rawOnly: true }).catch(() => {});
  }
}
ipcMain.on('mic:pcm', (_e, arrayBuffer) => acceptPcm('you', arrayBuffer));
ipcMain.on('system:pcm', (_e, arrayBuffer) => acceptPcm('them', arrayBuffer));
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
  localSTT.stop();
  globalShortcut.unregisterAll();
  if (tray) { tray.destroy(); tray = null; }
});
app.on('before-quit', (event) => {
  if ((state.capturing || finalizationPromise) && !allowQuit) { event.preventDefault(); void requestQuit(); }
});
app.on('window-all-closed', () => app.quit());
