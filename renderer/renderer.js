/* cue renderer — UI state, mic capture, IPC, streaming render. */
(function () {
  const { icon } = window.ICONS;
  const cue = window.cue; // exposed by preload
  const $ = (s) => document.querySelector(s);
  const cmdKey = cue.platform === 'darwin' ? '⌘' : 'Ctrl';
  const isCmdOrCtrl = (e) => cue.platform === 'darwin' ? e.metaKey : e.ctrlKey;

  // ---- paint icons -------------------------------------------------------
  $('#logo-btn').innerHTML = icon('logo', { size: 18 });
  $('.tb-hide .chev').innerHTML = icon('chevron-down', { size: 14 });
  $('#stop-btn').innerHTML = icon('play', { size: 15 });
  document.querySelector('.act[data-mode="assist"] .ic').innerHTML = icon('sparkles', { size: 16 });
  document.querySelector('.act[data-mode="say"] .ic').innerHTML = icon('wand-sparkles', { size: 16 });
  document.querySelector('.act[data-mode="followup"] .ic').innerHTML = icon('message-circle', { size: 16 });
  document.querySelector('.act[data-mode="recap"] .ic').innerHTML = icon('refresh-cw', { size: 16 });
  $('#smart-toggle .ic').innerHTML = icon('zap', { size: 14 });
  $('#copy-btn').innerHTML = icon('copy', { size: 16 });
  $('#more-btn').innerHTML = icon('more-horizontal', { size: 18 });
  $('#send-btn').innerHTML = icon('play', { size: 15 });

  // ---- state -------------------------------------------------------------
  let settings = null;
  let busy = false;
  let aiEl = null;       // current streaming <div class="ai-text">
  let caretEl = null;

  const UI_TEXT = {
    en: {
      hide: 'Hide', assist: 'Assist', say: 'What should I say?', followup: 'Follow-up questions', recap: 'Recap', smart: 'Smart', copy: 'Copy messages',
      settings: 'Settings', done: 'Done', provider: 'Provider', apiEndpoint: 'API endpoint', officialHint: 'leave blank for the official API',
      baseUrl: 'Base URL', trustApi: 'I trust this destination for API requests', sendBearer: 'Send API key as a Bearer token',
      apiKeys: 'API keys', storedLocally: 'stored locally in cue-data.json', models: 'Models', modelHint: 'fast = Smart off · smart = Smart on',
      fastModel: 'Fast', smartModel: 'Smart', transcription: 'Transcription route', separateFromChat: 'separate from chat',
      useForSpeech: 'Use this provider for speech-to-text', sttKey: 'STT key', sendSttBearer: 'Send STT key as a Bearer token',
      sttModel: 'STT model', sttUrl: 'STT URL', sttProtocol: 'STT protocol', trustAudio: 'I trust this destination for API keys and audio', appearance: 'Appearance',
      language: 'Language', windowDrag: 'Allow dragging the cue window', backgroundColor: 'Background', opacity: 'Opacity',
      placeholder: 'Ask about your screen or conversation, or {key} {enter} for Assist', example: '“A discounted cash flow model values a company by projecting future free cash flows and discounting them to present value using the weighted average cost of capital.”',
      active: 'Active', customApi: 'custom API', officialApi: 'official API', apiNotSet: 'API not set', keys: 'keys', stt: 'STT', liveTranscript: 'Live transcript', hints: 'Cue hints', ready: 'Ready', listening: 'Listening', generating: 'Generating', error: 'Error'
    },
    ru: {
      hide: 'Скрыть', assist: 'Помоги', say: 'Что ответить?', followup: 'Что спросить дальше?', recap: 'Краткое резюме', smart: 'Умный режим', copy: 'Скопировать сообщения',
      settings: 'Настройки', done: 'Готово', provider: 'Провайдер', apiEndpoint: 'API endpoint', officialHint: 'пусто — официальный API',
      baseUrl: 'Базовый URL', trustApi: 'Я доверяю этому адресу для API-запросов', sendBearer: 'Отправлять API-ключ как Bearer-токен',
      apiKeys: 'API-ключи', storedLocally: 'хранятся локально в cue-data.json', models: 'Модели', modelHint: 'быстрый = Smart выкл. · умный = Smart вкл.',
      fastModel: 'Быстрая', smartModel: 'Умная', transcription: 'Маршрут расшифровки', separateFromChat: 'отдельно от чата',
      useForSpeech: 'Использовать провайдер для распознавания речи', sttKey: 'Ключ STT', sendSttBearer: 'Отправлять STT-ключ как Bearer-токен',
      sttModel: 'Модель STT', sttUrl: 'URL STT', sttProtocol: 'Протокол STT', trustAudio: 'Я доверяю этому адресу для API-ключа и аудио', appearance: 'Внешний вид',
      language: 'Язык интерфейса', windowDrag: 'Разрешить перетаскивание окна cue', backgroundColor: 'Цвет фона', opacity: 'Прозрачность',
      placeholder: 'Спроси про экран или разговор, или нажми {key} {enter} для помощи', example: '«Модель дисконтированных денежных потоков оценивает компанию через прогноз свободного денежного потока и приведение его к текущей стоимости по WACC.»',
      active: 'Активен', customApi: 'кастомный API', officialApi: 'официальный API', apiNotSet: 'API не задан', keys: 'ключи', stt: 'STT', liveTranscript: 'Живой конспект', hints: 'Подсказки', ready: 'Готово', listening: 'Слушаю', generating: 'Генерирую', error: 'Ошибка'
    }
  };

  function currentLanguage() { return settings && settings.appearance && settings.appearance.language === 'en' ? 'en' : 'ru'; }
  function t(key) { return (UI_TEXT[currentLanguage()] && UI_TEXT[currentLanguage()][key]) || UI_TEXT.en[key] || key; }

  function renderCaptureControl(active) {
    const button = $('#stop-btn');
    const language = currentLanguage();
    const label = active
      ? (language === 'ru' ? 'Остановить запись' : 'Stop recording')
      : (language === 'ru' ? 'Начать запись' : 'Start recording');
    button.innerHTML = icon(active ? 'stop-square' : 'play', { size: 15 });
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
    button.setAttribute('aria-label', label);
    button.title = label;
  }

  function applyLanguage() {
    const language = currentLanguage();
    document.documentElement.lang = language;
    document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    const ph = $('#placeholder');
    if (ph) ph.innerHTML = t('placeholder').replace('{key}', '<span class="keycap">' + cmdKey + '</span>').replace('{enter}', '<span class="keycap">↵</span>');
    const select = $('#appearance-language');
    if (select) select.value = language;
    const settingsButton = $('#more-btn');
    if (settingsButton) settingsButton.title = t('settings');
    const copyButton = $('#copy-btn');
    if (copyButton) { copyButton.title = t('copy'); copyButton.setAttribute('aria-label', t('copy')); }
    const sendButton = $('#send-btn');
    if (sendButton) sendButton.title = language === 'ru' ? 'Отправить' : 'Send';
    renderCaptureControl($('#stop-btn').classList.contains('active'));
  }

  function hexToRgb(hex) {
    const value = /^#([0-9a-f]{6})$/i.exec(String(hex || ''));
    if (!value) return [20, 22, 28];
    return [parseInt(value[1].slice(0, 2), 16), parseInt(value[1].slice(2, 4), 16), parseInt(value[1].slice(4, 6), 16)];
  }

  function applyAppearance() {
    const appearance = settings && settings.appearance ? settings.appearance : { language: 'ru', windowDrag: true, backgroundColor: '#14161c', backgroundOpacity: 0.72 };
    const [r, g, b] = hexToRgb(appearance.backgroundColor);
    const opacity = Math.min(0.95, Math.max(0.2, Number(appearance.backgroundOpacity) || 0.72));
    document.documentElement.style.setProperty('--glass-bg', `rgba(${r}, ${g}, ${b}, ${opacity})`);
    $('#app').classList.toggle('drag-enabled', appearance.windowDrag !== false);
    const opacityInput = $('#appearance-opacity');
    const opacityValue = $('#appearance-opacity-value');
    if (opacityInput) opacityInput.value = String(Math.round(opacity * 100));
    if (opacityValue) opacityValue.textContent = Math.round(opacity * 100) + '%';
    const colorInput = $('#appearance-color');
    if (colorInput) colorInput.value = appearance.backgroundColor;
  }

  function captureAppearanceFields() {
    if (!settings.appearance) settings.appearance = {};
    settings.appearance.language = $('#appearance-language').value === 'en' ? 'en' : 'ru';
    settings.appearance.windowDrag = !!$('#appearance-drag').checked;
    settings.appearance.backgroundColor = /^#[0-9a-f]{6}$/i.test($('#appearance-color').value) ? $('#appearance-color').value.toLowerCase() : '#14161c';
    settings.appearance.backgroundOpacity = Math.min(0.95, Math.max(0.2, Number($('#appearance-opacity').value || 72) / 100));
  }

  const messages = $('#messages');
  const liveTranscript = $('#live-transcript');
  const transcriptCountEl = $('#transcript-count');
  const assistStateEl = $('#assist-state');
  let transcriptCount = 0;
  let messagesFollow = true;

  function esc(s) { return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // minimal, safe markdown: fenced code, bullets, inline code, bold, paragraphs
  function renderMarkdown(text) {
    const lines = text.split('\n');
    let html = '', inCode = false, inList = false, buf = [];
    const flushP = () => { if (buf.length) { html += '<p>' + inline(buf.join(' ')) + '</p>'; buf = []; } };
    const inline = (s) => esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    for (const raw of lines) {
      const line = raw;
      if (/^```/.test(line.trim())) {
        if (!inCode) { flushP(); if (inList) { html += '</ul>'; inList = false; } html += '<pre><code>'; inCode = true; }
        else { html += '</code></pre>'; inCode = false; }
        continue;
      }
      if (inCode) { html += esc(line) + '\n'; continue; }
      if (/^\s*[-*]\s+/.test(line)) { flushP(); if (!inList) { html += '<ul>'; inList = true; } html += '<li>' + inline(line.replace(/^\s*[-*]\s+/, '')) + '</li>'; continue; }
      if (line.trim() === '') { flushP(); if (inList) { html += '</ul>'; inList = false; } continue; }
      buf.push(line.trim());
    }
    flushP(); if (inList) html += '</ul>'; if (inCode) html += '</code></pre>';
    return html;
  }

  function clearMessages() { messages.innerHTML = ''; aiEl = null; caretEl = null; messagesFollow = true; }

  messages.addEventListener('scroll', () => {
    messagesFollow = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 24;
  });

  function keepMessagesAtBottom() {
    if (messagesFollow) requestAnimationFrame(() => { messages.scrollTop = messages.scrollHeight; });
  }

  function clearLiveTranscript() {
    liveTranscript.innerHTML = '';
    transcriptCount = 0;
    transcriptCountEl.textContent = currentLanguage() === 'ru' ? 'Нет реплик' : 'No turns';
  }

  function appendTranscript(turn) {
    if (!turn || !turn.text) return;
    const atBottom = liveTranscript.scrollHeight - liveTranscript.scrollTop - liveTranscript.clientHeight < 24;
    const row = document.createElement('div');
    row.className = 'transcript-row ' + (turn.channel === 'them' ? 'them' : 'you');
    const meta = document.createElement('div');
    meta.className = 'transcript-meta';
    const speaker = document.createElement('span');
    speaker.className = 'transcript-speaker';
    speaker.textContent = currentLanguage() === 'ru' ? (turn.channel === 'them' ? 'Собеседник' : 'Вы') : (turn.channel === 'them' ? 'Them' : 'You');
    const source = document.createElement('span');
    source.className = 'transcript-source';
    source.textContent = currentLanguage() === 'ru' ? (turn.channel === 'them' ? 'система' : 'микрофон') : (turn.channel === 'them' ? 'system' : 'mic');
    const time = document.createElement('time');
    time.className = 'transcript-time';
    time.textContent = new Date(turn.ts || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    meta.append(speaker, source, time);
    const text = document.createElement('div');
    text.className = 'transcript-text';
    text.textContent = turn.text;
    row.append(meta, text);
    liveTranscript.appendChild(row);
    transcriptCount += 1;
    transcriptCountEl.textContent = currentLanguage() === 'ru' ? `${transcriptCount} ${transcriptCount === 1 ? 'реплика' : 'реплик'}` : `${transcriptCount} turn${transcriptCount === 1 ? '' : 's'}`;
    if (atBottom) requestAnimationFrame(() => { liveTranscript.scrollTop = liveTranscript.scrollHeight; });
  }

  function addUserBubble(text) {
    const b = document.createElement('div');
    b.className = 'user-bubble';
    b.textContent = text;
    messages.appendChild(b);
  }

  function startAi(small, label) {
    if (label) {
      const marker = document.createElement('div');
      marker.className = 'answer-label';
      marker.textContent = label;
      messages.appendChild(marker);
    }
    aiEl = document.createElement('div');
    aiEl.className = 'ai-text' + (small ? ' small' : '');
    aiEl.dataset.raw = '';
    caretEl = document.createElement('span');
    caretEl.className = 'ai-caret';
    aiEl.appendChild(caretEl);
    messages.appendChild(aiEl);
    keepMessagesAtBottom();
  }

  function appendToken(t) {
    if (!aiEl) startAi(false);
    aiEl.dataset.raw += t;
    aiEl.insertBefore(document.createTextNode(t), caretEl);
    keepMessagesAtBottom();
  }

  function finalizeAi() {
    if (!aiEl) return;
    const raw = aiEl.dataset.raw || '';
    aiEl.innerHTML = renderMarkdown(raw);
    aiEl = null; caretEl = null;
  }

  function setBusy(v) { busy = v; $('#send-btn').classList.toggle('busy', v); }

  // ---- actions -----------------------------------------------------------
  function runMode(mode, text) {
    if (busy) return;
    setBusy(true);
    cue.ask({ mode, text: text || '' });
  }

  const assistBtn = document.querySelector('.act[data-mode="assist"]');
  function syncAssistMode(active) {
    assistBtn.classList.toggle('active', !!active);
    assistBtn.setAttribute('aria-pressed', String(!!active));
  }
  document.querySelectorAll('.act').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (btn.dataset.mode === 'assist') {
        const active = await cue.assistToggle();
        syncAssistMode(active);
        return;
      }
      runMode(btn.dataset.mode, '');
    });
  });

  const input = $('#input');
  const placeholder = $('#placeholder');
  const composer = $('#composer');

  function syncPlaceholder() {
    placeholder.classList.toggle('hidden', input.value.length > 0 || document.activeElement === input);
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 140) + 'px';
  }
  input.addEventListener('input', syncPlaceholder);
  input.addEventListener('focus', () => { composer.classList.add('focused'); placeholder.classList.add('hidden'); });
  input.addEventListener('blur', () => { composer.classList.remove('focused'); syncPlaceholder(); });
  $('#input-area').addEventListener('click', () => input.focus());

  function send() {
    const text = input.value.trim();
    if (!text) { runMode('assist', ''); return; }
    input.value = ''; syncPlaceholder();
    runMode('ask', text);
  }
  $('#send-btn').addEventListener('click', send);
  $('#copy-btn').addEventListener('click', async () => {
    const text = [liveTranscript.innerText.trim(), messages.innerText.trim()].filter(Boolean).join('\n\n');
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      const area = document.createElement('textarea');
      area.value = text; document.body.appendChild(area); area.select();
      document.execCommand('copy'); area.remove();
    }
    showStatus(currentLanguage() === 'ru' ? 'Сообщения скопированы' : 'Messages copied');
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !isCmdOrCtrl(e)) { e.preventDefault(); send(); }
    if (e.key === 'Enter' && isCmdOrCtrl(e)) { e.preventDefault(); runMode('assist', ''); }
  });

  // Smart toggle
  const smartBtn = $('#smart-toggle');
  smartBtn.addEventListener('click', async () => {
    settings.smart = !settings.smart;
    smartBtn.classList.toggle('on', settings.smart);
    await cue.settingsSet({ smart: settings.smart });
  });

  // Hide / collapse
  $('#hide-btn').addEventListener('click', () => {
    const collapsed = $('#panel').classList.toggle('collapsed');
    $('#hide-btn').classList.toggle('collapsed', collapsed);
  });

  // Stop = start/stop listening. Kick off system-audio capture straight from the click so
  // the user-gesture is fresh for getDisplayMedia (loopback capture needs it).
  let captureTogglePending = false;
  let captureWanted = false;
  const captureHealth = { mic: 'idle', system: 'idle' };

  $('#stop-btn').addEventListener('click', async () => {
    if (captureTogglePending) return;
    const turningOn = !$('#stop-btn').classList.contains('active');
    captureWanted = turningOn;
    if (turningOn) void startSystemAudio();
    else { stopMic(); stopSystemAudio(); }
    captureTogglePending = true;
    try {
      await cue.captureToggle();
    } catch (err) {
      captureWanted = !turningOn;
      showCaptureError('Listening', err);
    } finally {
      captureTogglePending = false;
    }
  });

  function updateCaptureHealth() {
    const ready = captureWanted && Object.values(captureHealth).every((value) => value === 'ok');
    const warning = captureWanted && Object.values(captureHealth).includes('error');
    const indicator = $('#live-dot');
    indicator.classList.toggle('off', !captureWanted);
    indicator.classList.toggle('starting', captureWanted && !ready && !warning);
    indicator.classList.toggle('warning', warning);
    $('#stop-btn').classList.toggle('capture-warning', warning);
  }

  function removeAi() {
    if (!aiEl) return;
    const marker = aiEl.previousElementSibling;
    if (marker && marker.classList.contains('answer-label')) marker.remove();
    aiEl.remove();
    aiEl = null; caretEl = null;
  }

  function setCaptureHealth(channel, value) {
    captureHealth[channel] = value;
    updateCaptureHealth();
  }

  function mediaErrorDetail(err) {
    if (!err) return 'Unknown error.';
    if (err.name === 'NotAllowedError') return cue.platform === 'win32'
      ? 'Access was denied. Check Windows Settings > Privacy & security > Microphone.'
      : 'Access was denied.';
    if (err.name === 'NotFoundError') return 'No matching audio device was found.';
    if (err.name === 'NotReadableError') return 'The device is busy or unavailable.';
    return err.message || String(err);
  }

  function showCaptureError(label, err) {
    const message = label + ' unavailable: ' + mediaErrorDetail(err);
    cue.log(message);
    showStatus(message);
  }

  // ---- capture: mic (renderer side) --------------------------------------
  let audioCtx = null, micStream = null, micNode = null, micProc = null, micStartPromise = null;
  async function startMic() {
    if (micStream) return true;
    if (micStartPromise) return micStartPromise;
    setCaptureHealth('mic', 'starting');
    micStartPromise = (async () => {
      let stream = null, ctx = null, node = null, proc = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
        ctx = new AudioContext({ sampleRate: 16000 });
        await ctx.audioWorklet.addModule('./pcm-processor.js');
        node = ctx.createMediaStreamSource(stream);
        proc = new AudioWorkletNode(ctx, 'pcm-processor');
        proc.port.onmessage = (e) => cue.micPcm(e.data);
        const sink = ctx.createGain(); sink.gain.value = 0; // run processor silently
        node.connect(proc); proc.connect(sink); sink.connect(ctx.destination);
        if (!captureWanted) {
          proc.port.onmessage = null; proc.disconnect(); node.disconnect(); void ctx.close();
          stream.getTracks().forEach((track) => track.stop());
          setCaptureHealth('mic', 'idle');
          return false;
        }
        micStream = stream; audioCtx = ctx; micNode = node; micProc = proc;
        const track = stream.getAudioTracks()[0];
        if (track) track.addEventListener('ended', () => {
          if (micStream !== stream) return;
          stopMic();
          if (captureWanted) {
            setCaptureHealth('mic', 'error');
            showCaptureError('Microphone', new Error('The audio track ended.'));
          }
        }, { once: true });
        setCaptureHealth('mic', 'ok');
        return true;
      } catch (err) {
        if (proc) { proc.port.onmessage = null; proc.disconnect(); }
        if (node) node.disconnect();
        if (ctx) void ctx.close();
        if (stream) stream.getTracks().forEach((track) => track.stop());
        setCaptureHealth('mic', captureWanted ? 'error' : 'idle');
        if (captureWanted) showCaptureError('Microphone', err);
        return false;
      } finally {
        micStartPromise = null;
      }
    })();
    return micStartPromise;
  }
  function stopMic() {
    if (micProc) { micProc.port.onmessage = null; micProc.disconnect(); micProc = null; }
    if (micNode) { micNode.disconnect(); micNode = null; }
    if (audioCtx) { audioCtx.close(); audioCtx = null; }
    if (micStream) { micStream.getTracks().forEach((t) => t.stop()); micStream = null; }
    setCaptureHealth('mic', 'idle');
  }

  // ---- capture: system/meeting audio (getDisplayMedia loopback, in cue's process) ----
  let sysStream = null, sysCtx = null, sysNode = null, sysProc = null, sysStartPromise = null;
  async function startSystemAudio() {
    if (sysStream) return true;
    if (sysStartPromise) return sysStartPromise;
    setCaptureHealth('system', 'starting');
    sysStartPromise = (async () => {
      let stream = null, ctx = null, node = null, proc = null;
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        stream.getVideoTracks().forEach((track) => track.stop()); // we only want the audio
        const tracks = stream.getAudioTracks();
        if (!tracks.length) throw new Error('No system-audio loopback track was returned.');
        ctx = new AudioContext({ sampleRate: 16000 });
        await ctx.audioWorklet.addModule('./pcm-processor.js');
        node = ctx.createMediaStreamSource(new MediaStream(tracks));
        proc = new AudioWorkletNode(ctx, 'pcm-processor');
        proc.port.onmessage = (e) => cue.systemPcm(e.data);
        const sink = ctx.createGain(); sink.gain.value = 0;
        node.connect(proc); proc.connect(sink); sink.connect(ctx.destination);
        if (!captureWanted) {
          proc.port.onmessage = null; proc.disconnect(); node.disconnect(); void ctx.close();
          stream.getTracks().forEach((track) => track.stop());
          setCaptureHealth('system', 'idle');
          return false;
        }
        sysStream = stream; sysCtx = ctx; sysNode = node; sysProc = proc;
        const track = tracks[0];
        track.addEventListener('ended', () => {
          if (sysStream !== stream) return;
          stopSystemAudio();
          if (captureWanted) {
            setCaptureHealth('system', 'error');
            showCaptureError('System audio', new Error('The loopback track ended.'));
          }
        }, { once: true });
        setCaptureHealth('system', 'ok');
        cue.log('system audio: capturing loopback');
        return true;
      } catch (err) {
        if (proc) { proc.port.onmessage = null; proc.disconnect(); }
        if (node) node.disconnect();
        if (ctx) void ctx.close();
        if (stream) stream.getTracks().forEach((track) => track.stop());
        setCaptureHealth('system', captureWanted ? 'error' : 'idle');
        if (captureWanted) showCaptureError('System audio', err);
        return false;
      } finally {
        sysStartPromise = null;
      }
    })();
    return sysStartPromise;
  }
  function stopSystemAudio() {
    if (sysProc) { sysProc.port.onmessage = null; sysProc.disconnect(); sysProc = null; }
    if (sysNode) { sysNode.disconnect(); sysNode = null; }
    if (sysCtx) { sysCtx.close(); sysCtx = null; }
    if (sysStream) { sysStream.getTracks().forEach((t) => t.stop()); sysStream = null; }
    setCaptureHealth('system', 'idle');
  }

  // ---- events from main --------------------------------------------------
  cue.on('capture:state', ({ active }) => {
    captureWanted = active;
    renderCaptureControl(active);
    if (active) { void startMic(); void startSystemAudio(); clearMessages(); clearLiveTranscript(); assistStateEl.textContent = t('listening'); } else { stopMic(); stopSystemAudio(); assistStateEl.textContent = t('ready'); }
    updateCaptureHealth();
  });
  cue.on('transcript', appendTranscript);
  cue.on('llm:start', ({ userBubble, small, append, responseLabel }) => {
    if (!append) clearMessages();
    if (userBubble && !append) addUserBubble(userBubble);
    startAi(!!small, append ? responseLabel : '');
    assistStateEl.textContent = t('generating');
    setBusy(true);
  });
  cue.on('llm:token', ({ text }) => appendToken(text));
  cue.on('llm:done', ({ suppress }) => { if (suppress) removeAi(); else finalizeAi(); assistStateEl.textContent = t('ready'); setBusy(false); });
  cue.on('llm:error', ({ message }) => {
    if (!aiEl) startAi(true);
    aiEl.dataset.raw = message; finalizeAi(); setBusy(false);
    assistStateEl.textContent = t('error');
  });
  let statusTimer = null;
  function showStatus(message) {
    let el = document.getElementById('cue-status');
    if (!el) {
      el = document.createElement('div');
      el.id = 'cue-status';
      const panel = document.getElementById('panel');
      panel.insertBefore(el, document.getElementById('action-row'));
    }
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => el.classList.remove('show'), 11000);
  }
  cue.on('status', ({ message }) => { cue.log('[status] ' + message); showStatus(message); });

  // ---- settings ----------------------------------------------------------
  const scrim = $('#settings-scrim');
  const providerNames = ['openai', 'anthropic', 'gemini', 'nvidia', 'compatible'];
  const sttProviderNames = ['openai', 'gemini', 'compatible'];
  const officialEndpoints = {
    openai: 'https://api.openai.com/v1',
    anthropic: 'https://api.anthropic.com',
    gemini: 'https://generativelanguage.googleapis.com',
    nvidia: 'https://integrate.api.nvidia.com/v1'
  };
  const endpointPlaceholders = {
    ...officialEndpoints,
    compatible: 'http://localhost:11434/v1'
  };
  const sttDefaultModels = { openai: 'whisper-1', gemini: 'gemini-2.5-flash', compatible: '' };
  const endpointTrustDraft = {};
  const sttTrustDraft = {};
  let settingsSaving = false;

  function openSettings() {
    if (!settings) return;
    fillSettings();
    scrim.classList.remove('hidden');
  }
  async function closeSettings() {
    if (settingsSaving) return;
    settingsSaving = true;
    const saved = await saveSettings();
    settingsSaving = false;
    if (saved) scrim.classList.add('hidden');
  }
  $('#more-btn').addEventListener('click', openSettings);
  $('#s-close').addEventListener('click', closeSettings);
  scrim.addEventListener('click', (e) => { if (e.target === scrim) closeSettings(); });
  cue.on('settings:open', openSettings);

  function ensureSettingsShape() {
    if (!settings.apiKeys) settings.apiKeys = {};
    if (!settings.baseUrls) settings.baseUrls = {};
    if (!settings.trustedBaseUrls) settings.trustedBaseUrls = {};
    if (!settings.authModes) settings.authModes = {};
    if (!settings.appearance) settings.appearance = {};
    if (!settings.sttApiKeys) settings.sttApiKeys = {};
    if (!settings.models) settings.models = {};
    if (!settings.stt) settings.stt = {};
    if (!settings.stt.routes) settings.stt.routes = {};
    for (const provider of providerNames) {
      if (settings.apiKeys[provider] === undefined) settings.apiKeys[provider] = '';
      if (settings.baseUrls[provider] === undefined) settings.baseUrls[provider] = '';
      if (settings.trustedBaseUrls[provider] === undefined) settings.trustedBaseUrls[provider] = '';
      if (!settings.models[provider]) settings.models[provider] = { fast: '', smart: '' };
    }
    settings.authModes.compatible = settings.authModes.compatible === 'none' ? 'none' : 'bearer';
    settings.appearance.language = settings.appearance.language === 'en' ? 'en' : 'ru';
    settings.appearance.windowDrag = settings.appearance.windowDrag !== false;
    settings.appearance.backgroundColor = /^#[0-9a-f]{6}$/i.test(settings.appearance.backgroundColor || '') ? settings.appearance.backgroundColor.toLowerCase() : '#14161c';
    const appearanceOpacity = Number(settings.appearance.backgroundOpacity);
    settings.appearance.backgroundOpacity = Number.isFinite(appearanceOpacity) ? Math.min(0.95, Math.max(0.2, appearanceOpacity)) : 0.72;
    for (const provider of sttProviderNames) {
      if (settings.sttApiKeys[provider] === undefined) settings.sttApiKeys[provider] = '';
      if (!settings.stt.routes[provider]) {
        settings.stt.routes[provider] = {
          enabled: provider !== 'compatible', baseUrl: '', trustedBaseUrl: '', model: sttDefaultModels[provider], authMode: 'bearer', protocol: 'transcriptions'
        };
      }
      settings.stt.routes[provider].protocol = provider === 'compatible' && settings.stt.routes[provider].protocol === 'chat-audio' ? 'chat-audio' : 'transcriptions';
    }
  }

  function fillSettings() {
    ensureSettingsShape();
    for (const provider of providerNames) {
      endpointTrustDraft[provider] = trustedValue(settings.baseUrls[provider], settings.trustedBaseUrls[provider], provider);
    }
    for (const provider of sttProviderNames) {
      const route = settings.stt.routes[provider];
      sttTrustDraft[provider] = trustedValue(route.baseUrl, route.trustedBaseUrl, provider);
    }
    document.querySelectorAll('#provider-seg button').forEach((b) => b.classList.toggle('on', b.dataset.provider === settings.provider));
    $('#key-openai').value = settings.apiKeys.openai || '';
    $('#key-anthropic').value = settings.apiKeys.anthropic || '';
    $('#key-gemini').value = settings.apiKeys.gemini || '';
    $('#key-nvidia').value = settings.apiKeys.nvidia || '';
    $('#key-compatible').value = settings.apiKeys.compatible || '';
    $('#appearance-language').value = settings.appearance.language;
    $('#appearance-drag').checked = settings.appearance.windowDrag;
    $('#appearance-color').value = settings.appearance.backgroundColor;
    $('#appearance-opacity').value = String(Math.round(settings.appearance.backgroundOpacity * 100));
    $('#appearance-opacity-value').textContent = Math.round(settings.appearance.backgroundOpacity * 100) + '%';
    applyLanguage();
    applyAppearance();
    fillProviderFields(settings.provider);
    $('#s-status').textContent = statusText();
  }

  function fillProviderFields(provider) {
    const m = settings.models[provider] || { fast: '', smart: '' };
    $('#model-fast').value = m.fast;
    $('#model-smart').value = m.smart;
    $('#base-url').value = settings.baseUrls[provider] || '';
    $('#base-url').placeholder = endpointPlaceholders[provider] || 'https://api.example.com/v1';
    $('#endpoint-trust').checked = endpointTrustDraft[provider] === normalizedOrEmpty(settings.baseUrls[provider], provider);
    $('#auth-mode-row').classList.toggle('hidden', provider !== 'compatible');
    $('#send-auth').checked = settings.authModes.compatible !== 'none';
    updateEndpointNote(false);

    const hasStt = sttProviderNames.includes(provider);
    $('#stt-route-group').classList.toggle('hidden', !hasStt);
    if (hasStt) {
      const route = settings.stt.routes[provider];
      $('#stt-enabled').checked = !!route.enabled;
      $('#stt-api-key').value = settings.sttApiKeys[provider] || '';
      $('#stt-auth-mode-row').classList.toggle('hidden', provider !== 'compatible');
      $('#stt-send-auth').checked = route.authMode !== 'none';
      $('#stt-protocol-field').classList.toggle('hidden', provider !== 'compatible');
      $('#stt-protocol').value = route.protocol === 'chat-audio' ? 'chat-audio' : 'transcriptions';
      $('#stt-model').value = route.model || '';
      $('#stt-base-url').value = route.baseUrl || '';
      $('#stt-base-url').placeholder = provider === 'compatible'
        ? 'http://localhost:8000/v1'
        : endpointPlaceholders[provider];
      $('#stt-endpoint-trust').checked = sttTrustDraft[provider] === normalizedOrEmpty(route.baseUrl, provider);
      updateSttKeyPlaceholder();
      updateSttControls(false);
    }
  }

  function captureProviderFields(provider) {
    if (!settings.models[provider]) settings.models[provider] = {};
    settings.models[provider].fast = $('#model-fast').value.trim();
    settings.models[provider].smart = $('#model-smart').value.trim();
    settings.baseUrls[provider] = $('#base-url').value.trim();
    endpointTrustDraft[provider] = $('#endpoint-trust').checked ? normalizedOrEmpty(settings.baseUrls[provider], provider) : '';
    if (provider === 'compatible') settings.authModes.compatible = $('#send-auth').checked ? 'bearer' : 'none';
    if (sttProviderNames.includes(provider)) {
      const route = settings.stt.routes[provider];
      route.enabled = $('#stt-enabled').checked;
      settings.sttApiKeys[provider] = $('#stt-api-key').value.trim();
      route.authMode = provider === 'compatible' && !$('#stt-send-auth').checked ? 'none' : 'bearer';
      route.protocol = provider === 'compatible' && $('#stt-protocol').value === 'chat-audio' ? 'chat-audio' : 'transcriptions';
      route.model = $('#stt-model').value.trim();
      route.baseUrl = $('#stt-base-url').value.trim();
      sttTrustDraft[provider] = $('#stt-endpoint-trust').checked ? normalizedOrEmpty(route.baseUrl, provider) : '';
    }
  }

  function isLocalEndpointHost(hostname) {
    const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
    const parts = host.split('.').map(Number);
    const loopbackV4 = parts.length === 4
      && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
      && parts[0] === 127;
    return host === 'localhost' || host.endsWith('.localhost') || host === 'host.docker.internal' || host === '::1' || loopbackV4;
  }

  function normalizeEndpointInput(value, provider) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    let url;
    try { url = new URL(raw); }
    catch { throw new Error('Enter a complete Base URL, for example https://api.example.com/v1.'); }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Base URL must use https://, or http:// for a local endpoint.');
    if (url.username || url.password) throw new Error('Do not put credentials inside the Base URL.');
    if (url.search || url.hash) throw new Error('Base URL cannot contain a query string or fragment.');
    if (url.protocol === 'http:' && !isLocalEndpointHost(url.hostname)) throw new Error('Use HTTPS unless the endpoint is on this computer (localhost/loopback).');
    const path = url.pathname.replace(/\/+$/, '');
    const normalized = url.origin + (path && path !== '/' ? path : '');
    return provider && officialEndpoints[provider] === normalized ? '' : normalized;
  }

  function normalizedOrEmpty(value, provider) {
    try { return normalizeEndpointInput(value, provider); }
    catch { return ''; }
  }

  function trustedValue(baseUrl, trustedBaseUrl, provider) {
    const base = normalizedOrEmpty(baseUrl, provider);
    const trusted = normalizedOrEmpty(trustedBaseUrl, provider);
    return base && base === trusted ? base : '';
  }

  function updateEndpointNote(resetTrust) {
    const input = $('#base-url');
    const note = $('#endpoint-note');
    const trustRow = $('#endpoint-trust-row');
    const raw = input.value.trim();
    updateSttKeyPlaceholder();
    input.classList.remove('invalid');
    note.className = 's-endpoint-note';
    if (!raw) {
      trustRow.classList.add('hidden');
      if (settings.provider === 'compatible') {
        note.classList.add('error');
        note.textContent = 'A Base URL is required for the Custom provider.';
      } else {
        note.textContent = 'Official endpoint: ' + endpointPlaceholders[settings.provider];
      }
      return;
    }
    try {
      const normalized = normalizeEndpointInput(raw, settings.provider);
      if (!normalized) {
        trustRow.classList.add('hidden');
        note.textContent = 'Official endpoint: ' + endpointPlaceholders[settings.provider];
        return;
      }
      const host = new URL(normalized).host;
      if (resetTrust && endpointTrustDraft[settings.provider] !== normalized) {
        endpointTrustDraft[settings.provider] = '';
        $('#endpoint-trust').checked = false;
      }
      trustRow.classList.remove('hidden');
      note.classList.add('custom');
      note.textContent = 'Custom endpoint: your API key, prompts, and screenshots can be sent to ' + host + '.';
    } catch (error) {
      trustRow.classList.add('hidden');
      input.classList.add('invalid');
      note.classList.add('error');
      note.textContent = error.message;
    }
  }

  function updateSttKeyPlaceholder() {
    if (!sttProviderNames.includes(settings.provider)) return;
    const noAuth = settings.provider === 'compatible' && !$('#stt-send-auth').checked;
    const customChat = !!normalizedOrEmpty($('#base-url').value, settings.provider);
    const customStt = !!normalizedOrEmpty($('#stt-base-url').value, settings.provider);
    $('#stt-api-key').placeholder = noAuth
      ? 'not used in No authentication mode'
      : (customChat || customStt || settings.provider === 'compatible' ? 'required for this route' : 'optional for official API');
  }

  function updateSttControls(resetTrust) {
    const provider = settings.provider;
    const enabled = $('#stt-enabled').checked;
    const group = $('#stt-route-group');
    const input = $('#stt-base-url');
    const note = $('#stt-endpoint-note');
    const trustRow = $('#stt-trust-row');
    updateSttKeyPlaceholder();
    group.classList.toggle('disabled', !enabled);
    input.classList.remove('invalid');
    note.className = 's-endpoint-note';
    if (!enabled) {
      trustRow.classList.add('hidden');
      note.textContent = 'This transcription route is disabled.';
      return;
    }
    const raw = input.value.trim();
    if (!raw) {
      trustRow.classList.add('hidden');
      if (provider === 'compatible') {
        input.classList.add('invalid');
        note.classList.add('error');
        note.textContent = 'A separate STT Base URL is required for compatible transcription.';
      } else {
        note.textContent = 'Official transcription endpoint: ' + endpointPlaceholders[provider];
      }
      return;
    }
    try {
      const normalized = normalizeEndpointInput(raw, provider);
      if (!normalized) {
        trustRow.classList.add('hidden');
        note.textContent = 'Official transcription endpoint: ' + endpointPlaceholders[provider];
        return;
      }
      const host = new URL(normalized).host;
      if (resetTrust && sttTrustDraft[provider] !== normalized) {
        sttTrustDraft[provider] = '';
        $('#stt-endpoint-trust').checked = false;
      }
      trustRow.classList.remove('hidden');
      note.classList.add('custom');
      note.textContent = 'Audio and the transcription API credential can be sent to ' + host + '.';
    } catch (error) {
      trustRow.classList.add('hidden');
      input.classList.add('invalid');
      note.classList.add('error');
      note.textContent = error.message;
    }
  }

  $('#base-url').addEventListener('input', () => updateEndpointNote(true));
  $('#endpoint-trust').addEventListener('change', () => {
    endpointTrustDraft[settings.provider] = $('#endpoint-trust').checked
      ? normalizedOrEmpty($('#base-url').value, settings.provider) : '';
  });
  $('#stt-base-url').addEventListener('input', () => updateSttControls(true));
  $('#stt-enabled').addEventListener('change', () => updateSttControls(false));
  $('#send-auth').addEventListener('change', updateSttKeyPlaceholder);
  $('#stt-send-auth').addEventListener('change', updateSttKeyPlaceholder);
  $('#stt-endpoint-trust').addEventListener('change', () => {
    sttTrustDraft[settings.provider] = $('#stt-endpoint-trust').checked
      ? normalizedOrEmpty($('#stt-base-url').value, settings.provider) : '';
  });
  $('#appearance-language').addEventListener('change', () => {
    captureAppearanceFields();
    applyLanguage();
    $('#s-status').textContent = statusText();
  });
  $('#appearance-drag').addEventListener('change', () => { captureAppearanceFields(); applyAppearance(); });
  $('#appearance-color').addEventListener('input', () => { captureAppearanceFields(); applyAppearance(); });
  $('#appearance-opacity').addEventListener('input', () => { captureAppearanceFields(); applyAppearance(); });

  function legacyStatusText() {
    const k = settings.apiKeys;
    const has = [k.openai && 'OpenAI', k.anthropic && 'Anthropic', k.gemini && 'Gemini', k.nvidia && 'Nvidia', k.compatible && 'Custom'].filter(Boolean);
    const stt = sttProviderNames.filter((provider) => settings.stt.routes[provider].enabled).join(' → ') || 'none';
    const endpoint = settings.baseUrls[settings.provider]
      ? 'custom API'
      : (settings.provider === 'compatible' ? 'API not set' : 'official API');
    return 'Active: ' + settings.provider + ' · ' + endpoint + ' · keys: ' + (has.join(', ') || 'none set') + ' · STT: ' + stt;
  }
  function statusText() {
    const k = settings.apiKeys;
    const has = [k.openai && 'OpenAI', k.anthropic && 'Anthropic', k.gemini && 'Gemini', k.nvidia && 'Nvidia', k.compatible && 'Custom'].filter(Boolean);
    const stt = sttProviderNames.filter((provider) => settings.stt.routes[provider].enabled).join(' → ') || 'none';
    const endpoint = settings.baseUrls[settings.provider] ? t('customApi') : (settings.provider === 'compatible' ? t('apiNotSet') : t('officialApi'));
    return t('active') + ': ' + settings.provider + ' · ' + endpoint + ' · ' + t('keys') + ': ' + (has.join(', ') || 'none set') + ' · ' + t('stt') + ': ' + stt;
  }
  document.querySelectorAll('#provider-seg button').forEach((b) => b.addEventListener('click', () => {
    captureProviderFields(settings.provider);
    settings.provider = b.dataset.provider;
    document.querySelectorAll('#provider-seg button').forEach((x) => x.classList.toggle('on', x === b));
    fillProviderFields(settings.provider);
    $('#s-status').textContent = statusText();
  }));

  function settingsValidationError(message, provider, field) {
    const error = new Error(message);
    error.provider = provider;
    error.field = field;
    return error;
  }

  async function saveSettings() {
    captureAppearanceFields();
    settings.apiKeys.openai = $('#key-openai').value.trim();
    settings.apiKeys.anthropic = $('#key-anthropic').value.trim();
    settings.apiKeys.gemini = $('#key-gemini').value.trim();
    settings.apiKeys.nvidia = $('#key-nvidia').value.trim();
    settings.apiKeys.compatible = $('#key-compatible').value.trim();
    captureProviderFields(settings.provider);
    try {
      for (const provider of providerNames) {
        let normalized;
        try { normalized = normalizeEndpointInput(settings.baseUrls[provider], provider); }
        catch (error) { throw settingsValidationError(provider + ' Base URL: ' + error.message, provider, 'llm'); }
        settings.baseUrls[provider] = normalized;
        if (normalized) {
          if (endpointTrustDraft[provider] !== normalized) {
            throw settingsValidationError('Confirm that you trust the ' + provider + ' destination before saving.', provider, 'llm');
          }
          settings.trustedBaseUrls[provider] = normalized;
        } else {
          settings.trustedBaseUrls[provider] = '';
        }
      }

      for (const provider of sttProviderNames) {
        const route = settings.stt.routes[provider];
        let normalized;
        try { normalized = normalizeEndpointInput(route.baseUrl, provider); }
        catch (error) { throw settingsValidationError(provider + ' STT Base URL: ' + error.message, provider, 'stt'); }
        route.baseUrl = normalized;
        if (route.enabled && !route.model) {
          throw settingsValidationError('Set a transcription model for ' + provider + '.', provider, 'stt');
        }
        if (route.enabled && provider === 'compatible' && !normalized) {
          throw settingsValidationError('Set a separate STT Base URL for compatible transcription.', provider, 'stt');
        }
        if (route.enabled && normalized) {
          if (sttTrustDraft[provider] !== normalized) {
            throw settingsValidationError('Confirm that you trust the ' + provider + ' transcription destination before saving.', provider, 'stt');
          }
          route.trustedBaseUrl = normalized;
        } else if (!normalized) {
          route.trustedBaseUrl = '';
        }
      }
      settings = await cue.settingsSet(settings);
      applyLanguage();
      applyAppearance();
      fillSettings();
      return true;
    } catch (error) {
      const message = String(error && error.message ? error.message : error).replace(/^Error invoking remote method '[^']+': Error:\s*/, '');
      if (error.provider && error.provider !== settings.provider) {
        settings.provider = error.provider;
        document.querySelectorAll('#provider-seg button').forEach((b) => b.classList.toggle('on', b.dataset.provider === settings.provider));
        fillProviderFields(settings.provider);
      }
      if (error.field === 'stt') {
        $('#stt-base-url').classList.add('invalid');
        $('#stt-endpoint-note').className = 's-endpoint-note error';
        $('#stt-endpoint-note').textContent = message;
      } else {
        $('#base-url').classList.add('invalid');
        $('#endpoint-note').className = 's-endpoint-note error';
        $('#endpoint-note').textContent = message;
      }
      return false;
    }
  }

  // ---- example conversation (matches the reference screenshot) ------------
  function showExample() {
    clearMessages();
    addUserBubble(t('say'));
    const ai = document.createElement('div');
    ai.className = 'ai-text';
    ai.textContent = '“A discounted cash flow model values a company by projecting future free cash flows and discounting them to present value using the weighted average cost of capital.”';
    ai.textContent = t('example');
    messages.appendChild(ai);
  }

  // ---- global keys -------------------------------------------------------
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !scrim.classList.contains('hidden')) closeSettings();
    if (isCmdOrCtrl(e)) {
      if (e.key === ',') { e.preventDefault(); openSettings(); }
    }
  });

  // UI Zoom buttons (text only)
  let currentZoom = 1;
  function updateZoom(delta) {
    currentZoom = Math.max(0.5, Math.min(3, currentZoom + delta));
    document.documentElement.style.setProperty('--text-zoom', currentZoom);
  }
  $('#zoom-in-btn').addEventListener('click', () => updateZoom(0.1));
  $('#zoom-out-btn').addEventListener('click', () => updateZoom(-0.1));

  // ---- click-through: only the UI blocks the mouse; empty gaps pass to your screen ----
  let ignoring = null;
  function setIgnore(v) { if (v !== ignoring) { ignoring = v; cue.setIgnoreMouse(v); } }
  document.addEventListener('mousemove', (e) => {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const overUI = !!(el && el.closest && el.closest('#toolbar, #panel-wrap, #settings-scrim, #onboard-scrim'));
    setIgnore(!overUI);
  });
  setIgnore(true); // start fully click-through; hovering the panel re-enables it

  // ---- onboarding / first-run tutorial -----------------------------------
  const obScrim = $('#onboard-scrim');
  const OB_STEPS = [
    {
      icon: '👋',
      title: 'Welcome to cue',
      body: 'cue is a private AI copilot that floats over your screen. It can <strong>see your screen</strong>, <strong>hear your meetings</strong>, and help you answer questions or solve coding problems — while staying hidden from most screen shares.<br><br>This quick guide gets you running in about a minute.'
    },
    ...(cue.platform === 'darwin' ? [{
      icon: '🔐',
      title: 'Allow cue to see & hear',
      body: 'cue needs two macOS permissions. Click each button, turn <strong>cue</strong> ON in the window that opens, then come back here.<ul><li><strong>Microphone</strong> — to hear you</li><li><strong>Screen Recording</strong> — to see your screen and hear meeting audio</li></ul>',
      buttons: [
        { label: 'Open Microphone settings', action: () => cue.openPane('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone') },
        { label: 'Open Screen Recording settings', action: () => cue.openPane('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture') }
      ]
    }] : []),
    ...(cue.platform === 'win32' ? [{
      icon: '🔐',
      title: 'Allow microphone access',
      body: 'Windows must allow microphone access for desktop apps. Turn on <strong>Microphone access</strong> and <strong>Let desktop apps access your microphone</strong>. Screen capture and system-audio loopback do not need a separate Windows permission.',
      buttons: [
        { label: 'Open Windows microphone settings', action: () => cue.openPane('ms-settings:privacy-microphone') }
      ]
    }] : []),
    {
      icon: '🔑',
      title: 'Connect an AI provider',
      body: 'cue uses <strong>your own</strong> API key — pick <span class="hl">OpenAI</span>, <span class="hl">Anthropic</span>, <span class="hl">Google Gemini</span>, <span class="hl">Nvidia</span>, or a <span class="hl">Custom OpenAI-compatible</span> endpoint. Official APIs remain the default; custom destinations require explicit trust.<br><br><strong>Tip:</strong> chat and speech-to-text endpoints are separate, so a custom chat gateway never receives meeting audio unless you enable it as an STT route.',
      buttons: [{ label: 'Open cue Settings', action: () => { finishOnboard(); openSettings(); } }]
    },
    {
      icon: '🫥',
      title: 'Stay hidden in Zoom',
      body: cue.platform === 'darwin'
        ? 'cue is hidden from most screen shares automatically (Google Meet, Teams, QuickTime — nothing to do). <strong>Zoom needs one setting:</strong><br><br>Zoom → <span class="hl">Settings</span> → <span class="hl">Share Screen</span> → <span class="hl">Advanced</span> → <strong>Screen capture mode</strong> → choose <strong>“Advanced capture with window filtering.”</strong><br><br>Avoid “<strong>without</strong> window filtering” — that mode reveals cue.'
        : 'On Windows 10 version 2004+ and Windows 11, cue asks Windows to exclude the overlay from capture. This is <strong>best-effort</strong>, so test it before a real share. <strong>For Zoom:</strong><br><br>Zoom → <span class="hl">Settings</span> → <span class="hl">Share Screen</span> → <span class="hl">Advanced</span> → <strong>Screen capture mode</strong> → choose <strong>“Advanced capture with window filtering.”</strong>'
    },
    {
      icon: '✨',
      title: 'You’re all set',
      body: `How to use cue:<ul><li><span class="kbd">${cmdKey}</span> <span class="kbd">↵</span> — <strong>Assist</strong> with whatever's on screen or being said</li><li><span class="kbd">${cmdKey}</span> <span class="kbd">H</span> — solve a coding problem on screen</li><li>Click <strong>Play</strong> in the top bar to start recording; it changes to <strong>Stop</strong> while active</li><li>Type a question and press <span class="kbd">↵</span></li></ul>Reopen this guide anytime by clicking the <strong>cue logo</strong>. On Windows, use <span class="kbd">Ctrl</span><span class="kbd">⇧</span><span class="kbd">T</span> or the tray icon to show/hide cue. Quit with <span class="kbd">${cmdKey}</span><span class="kbd">⇧</span><span class="kbd">X</span>.`
    }
  ];
  let obIndex = 0;
  function renderOnboard() {
    const step = OB_STEPS[obIndex];
    $('#ob-icon').textContent = step.icon;
    $('#ob-title').textContent = step.title;
    $('#ob-body').innerHTML = step.body;
    const btns = $('#ob-buttons'); btns.innerHTML = '';
    (step.buttons || []).forEach((b) => { const el = document.createElement('button'); el.textContent = b.label; el.addEventListener('click', b.action); btns.appendChild(el); });
    const dots = $('#ob-dots'); dots.innerHTML = '';
    OB_STEPS.forEach((_, i) => { const d = document.createElement('span'); if (i === obIndex) d.className = 'on'; dots.appendChild(d); });
    $('#ob-back').style.visibility = obIndex === 0 ? 'hidden' : 'visible';
    $('#ob-next').textContent = obIndex === OB_STEPS.length - 1 ? 'Done' : 'Next';
    $('#ob-skip').style.visibility = obIndex === OB_STEPS.length - 1 ? 'hidden' : 'visible';
  }
  function showOnboard() { obIndex = 0; renderOnboard(); obScrim.classList.remove('hidden'); setIgnore(false); }
  async function finishOnboard() {
    obScrim.classList.add('hidden');
    if (settings && !settings.onboarded) { settings.onboarded = true; await cue.settingsSet({ onboarded: true }); }
  }
  $('#ob-next').addEventListener('click', () => { if (obIndex === OB_STEPS.length - 1) finishOnboard(); else { obIndex++; renderOnboard(); } });
  $('#ob-back').addEventListener('click', () => { if (obIndex > 0) { obIndex--; renderOnboard(); } });
  $('#ob-skip').addEventListener('click', finishOnboard);
  $('#logo-btn').addEventListener('click', showOnboard);

  // ---- boot --------------------------------------------------------------
  (async function boot() {
    settings = await cue.settingsGet();
    if (cue.platform !== 'darwin') {
      $('#placeholder').innerHTML = 'Ask about your screen or conversation, or <span class="keycap">Ctrl</span><span class="keycap">⏎</span> for Assist';
    }
    applyLanguage();
    applyAppearance();
    smartBtn.classList.toggle('on', !!settings.smart);
    clearLiveTranscript();
    assistStateEl.textContent = t('ready');
    showExample();
    syncPlaceholder();
    const st = await cue.captureState();
    captureWanted = !!st.active;
    renderCaptureControl(!!st.active);
    if (st.active) { void startMic(); void startSystemAudio(); }
    updateCaptureHealth();
    if (!settings.onboarded) showOnboard();

    if (cue.platform === 'win32') {
      const keycaps = document.querySelectorAll('#placeholder .keycap');
      if (keycaps.length > 0) keycaps[0].textContent = 'Ctrl';
    }
    applyLanguage();
  })();
})();
