/* cue renderer — UI state, mic capture, IPC, streaming render. */
(function () {
  const { icon } = window.ICONS;
  const cue = window.cue; // exposed by preload
  const $ = (s) => document.querySelector(s);
  const cmdKey = cue.platform === 'darwin' ? '⌘' : 'Ctrl';
  const isCmdOrCtrl = (e) => cue.platform === 'darwin' ? e.metaKey : e.ctrlKey;

  const customControls = [];
  function closeCustomPopovers(except) {
    document.querySelectorAll('.custom-select.open, .color-control.open').forEach((control) => {
      if (control === except) return;
      control.classList.remove('open');
      const trigger = control.querySelector('[aria-expanded]');
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
    });
  }

  function upgradeSelect(select) {
    const control = document.createElement('div');
    control.className = 'custom-select';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'custom-select-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    const value = document.createElement('span');
    value.className = 'custom-select-value';
    const chevron = document.createElement('span');
    chevron.className = 'custom-select-chevron';
    chevron.innerHTML = icon('chevron-down', { size: 14 });
    trigger.append(value, chevron);
    const menu = document.createElement('div');
    menu.className = 'custom-select-menu';
    menu.setAttribute('role', 'listbox');
    control.append(trigger, menu);
    select.parentNode.insertBefore(control, select);
    control.appendChild(select);
    select.classList.add('native-control-source');

    const sync = () => {
      const selected = select.options[select.selectedIndex] || select.options[0];
      value.textContent = selected ? selected.textContent : '';
      menu.innerHTML = '';
      [...select.options].forEach((option) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'custom-select-option';
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', String(option.value === select.value));
        item.textContent = option.textContent;
        if (option.value === select.value) item.classList.add('selected');
        item.addEventListener('click', () => {
          select.value = option.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          sync();
          closeCustomPopovers();
          trigger.focus();
        });
        menu.appendChild(item);
      });
    };
    trigger.addEventListener('click', () => {
      const opening = !control.classList.contains('open');
      closeCustomPopovers(control);
      control.classList.toggle('open', opening);
      trigger.setAttribute('aria-expanded', String(opening));
      if (opening) (menu.querySelector('.selected') || menu.firstElementChild)?.focus();
    });
    select.addEventListener('change', sync);
    sync();
    customControls.push(sync);
  }

  function upgradeColorInput(input) {
    const control = document.createElement('div');
    control.className = 'color-control';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'color-trigger';
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-expanded', 'false');
    const swatch = document.createElement('span');
    swatch.className = 'color-trigger-swatch';
    const label = document.createElement('span');
    label.className = 'color-trigger-label';
    trigger.append(swatch, label);
    const popover = document.createElement('div');
    popover.className = 'color-popover';
    const palette = document.createElement('div');
    palette.className = 'color-palette';
    const colors = ['#08090c', '#14161c', '#101827', '#243047', '#3c83f5', '#7c8cff', '#22c55e', '#d5a85b', '#ef4444', '#f5f5f5'];
    const hex = document.createElement('input');
    hex.className = 'color-hex';
    hex.type = 'text';
    hex.maxLength = 7;
    hex.spellcheck = false;
    const apply = (next) => {
      if (!/^#[0-9a-f]{6}$/i.test(next)) return false;
      input.value = next.toLowerCase();
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    };
    colors.forEach((color) => {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'color-option';
      option.style.setProperty('--option-color', color);
      option.title = color;
      option.addEventListener('click', () => { apply(color); closeCustomPopovers(); trigger.focus(); });
      palette.appendChild(option);
    });
    hex.addEventListener('change', () => { if (!apply(hex.value.trim())) hex.classList.add('invalid'); else { hex.classList.remove('invalid'); closeCustomPopovers(); } });
    hex.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); hex.dispatchEvent(new Event('change')); } });
    popover.append(palette, hex);
    control.append(trigger, popover);
    input.parentNode.insertBefore(control, input);
    control.appendChild(input);
    input.classList.add('native-control-source');
    const sync = () => { swatch.style.background = input.value; label.textContent = input.value.toUpperCase(); hex.value = input.value.toUpperCase(); };
    input.addEventListener('input', sync);
    trigger.addEventListener('click', () => {
      const opening = !control.classList.contains('open');
      closeCustomPopovers(control);
      control.classList.toggle('open', opening);
      trigger.setAttribute('aria-expanded', String(opening));
      if (opening) setTimeout(() => hex.focus(), 0);
    });
    sync();
    customControls.push(sync);
  }

  document.querySelectorAll('select').forEach(upgradeSelect);
  document.querySelectorAll('input[type="color"]').forEach(upgradeColorInput);
  document.querySelectorAll('input[type="range"]').forEach((input) => {
    const sync = () => {
      const min = Number(input.min || 0);
      const max = Number(input.max || 100);
      const progress = max > min ? ((Number(input.value) - min) / (max - min)) * 100 : 0;
      input.style.setProperty('--range-progress', `${Math.max(0, Math.min(100, progress))}%`);
    };
    input.addEventListener('input', sync);
    sync();
    customControls.push(sync);
  });
  document.addEventListener('pointerdown', (event) => { if (!event.target.closest('.custom-select, .color-control')) closeCustomPopovers(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeCustomPopovers(); });

  // ---- custom tooltips --------------------------------------------------
  const tooltip = $('#custom-tooltip');
  let tooltipTarget = null;
  function setTooltip(element, text) {
    if (!element) return;
    element.removeAttribute('title');
    if (text) element.dataset.tooltip = text;
    else delete element.dataset.tooltip;
  }
  function adoptNativeTooltip(element) {
    if (!element || !element.getAttribute) return;
    const title = element.getAttribute('title');
    if (title) setTooltip(element, title);
  }
  function positionTooltip(target) {
    const rect = target.getBoundingClientRect();
    const box = tooltip.getBoundingClientRect();
    const margin = 8;
    const left = Math.max(margin, Math.min(window.innerWidth - box.width - margin, rect.left + rect.width / 2 - box.width / 2));
    let top = rect.top - box.height - 10;
    const below = top < margin;
    if (below) top = rect.bottom + 10;
    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.round(top)}px`;
    tooltip.classList.toggle('below', below);
  }
  function showTooltip(target) {
    const text = target && target.dataset ? target.dataset.tooltip : '';
    if (!text) return;
    tooltipTarget = target;
    tooltip.textContent = text;
    tooltip.classList.remove('hidden');
    requestAnimationFrame(() => { if (tooltipTarget === target) positionTooltip(target); });
  }
  function hideTooltip() {
    tooltipTarget = null;
    tooltip.classList.add('hidden');
  }
  document.querySelectorAll('[title]').forEach(adoptNativeTooltip);
  new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === 'attributes') adoptNativeTooltip(mutation.target);
      mutation.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        adoptNativeTooltip(node);
        node.querySelectorAll?.('[title]').forEach(adoptNativeTooltip);
      });
    });
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['title'] });
  document.addEventListener('pointerover', (event) => {
    const target = event.target.closest?.('[data-tooltip]');
    if (target && target !== tooltipTarget) showTooltip(target);
  });
  document.addEventListener('pointerout', (event) => {
    if (tooltipTarget && !tooltipTarget.contains(event.relatedTarget)) hideTooltip();
  });
  document.addEventListener('focusin', (event) => { const target = event.target.closest?.('[data-tooltip]'); if (target) showTooltip(target); });
  document.addEventListener('focusout', hideTooltip);
  window.addEventListener('resize', hideTooltip);
  document.addEventListener('scroll', hideTooltip, true);

  // ---- paint icons -------------------------------------------------------
  $('#logo-btn').innerHTML = icon('logo', { size: 18 });
  $('.tb-hide .panel-toggle-icon').innerHTML = icon('panel-top', { size: 16, stroke: 1.8 });
  $('#stop-btn').innerHTML = icon('play', { size: 15 });
  document.querySelector('.act[data-mode="assist"] .ic').innerHTML = icon('sparkles', { size: 16 });
  document.querySelector('.act[data-mode="say"] .ic').innerHTML = icon('wand-sparkles', { size: 16 });
  document.querySelector('.act[data-mode="followup"] .ic').innerHTML = icon('message-circle', { size: 16 });
  document.querySelector('.act[data-mode="recap"] .ic').innerHTML = icon('refresh-cw', { size: 16 });
  $('#finish-raw-btn .ic').innerHTML = icon('save', { size: 16 });
  $('#smart-toggle .ic').innerHTML = icon('zap', { size: 14 });
  $('#copy-btn').innerHTML = icon('copy', { size: 16 });
  $('#search-btn').innerHTML = icon('calendar-days', { size: 16 });
  $('#more-btn').innerHTML = icon('settings', { size: 16 });
  $('#send-btn').innerHTML = icon('play', { size: 15 });

  // ---- state -------------------------------------------------------------
  let settings = null;
  let busy = false;
  let aiEl = null;       // current streaming <div class="ai-text">
  let caretEl = null;

  const UI_TEXT = {
    en: {
      hide: 'Hide', assist: 'Assist', say: 'What should I say?', followup: 'Follow-up questions', recap: 'Recap', smart: 'Smart', copy: 'Copy messages',
      settings: 'Settings', done: 'Done', provider: 'Provider', providerTab: 'Provider', interfaceTab: 'Interface', apiKey: 'API key', apiEndpoint: 'API endpoint', officialHint: 'leave blank for the official API',
      baseUrl: 'Base URL', trustApi: 'I trust this destination for API requests', sendBearer: 'Send API key as a Bearer token',
      apiKeys: 'API keys', storedLocally: 'stored locally in cue-data.json', models: 'Models', modelHint: 'fast = Smart off · smart = Smart on',
      fastModel: 'Fast', smartModel: 'Smart', transcription: 'Transcription route', separateFromChat: 'separate from chat',
      useForSpeech: 'Use this provider for speech-to-text', sttKey: 'STT key', sendSttBearer: 'Send STT key as a Bearer token',
      sttModel: 'STT model', sttUrl: 'STT URL', sttProtocol: 'STT protocol', trustAudio: 'I trust this destination for API keys and audio', appearance: 'Appearance',
      language: 'Language', windowDrag: 'Drag the Cue window', backgroundColor: 'Background', accentColor: 'Accent', opacity: 'Opacity', textSize: 'Text size', blurStrength: 'Blur', cornerRadius: 'Corners', animations: 'Interface animations', themes: 'Themes', themeGraphite: 'Graphite', themeMidnight: 'Midnight', themeObsidian: 'Obsidian', themeArctic: 'Arctic', themeForest: 'Forest', themeWine: 'Wine', glassAppearance: 'Glass appearance', layout: 'Layout', behavior: 'Behavior', resetAppearance: 'Reset appearance',
      placeholder: 'Ask about your screen or conversation, or {key} {enter} for Assist', example: '“A discounted cash flow model values a company by projecting future free cash flows and discounting them to present value using the weighted average cost of capital.”',
      active: 'Active', customApi: 'custom API', officialApi: 'official API', apiNotSet: 'API not set', keys: 'keys', stt: 'STT', liveTranscript: 'Live transcript', hints: 'Cue hints', ready: 'Ready', listening: 'Listening', generating: 'Generating', error: 'Error'
    },
    ru: {
      hide: 'Скрыть', assist: 'Помоги', say: 'Что ответить?', followup: 'Что спросить дальше?', recap: 'Краткое резюме', smart: 'Умный режим', copy: 'Скопировать сообщения',
      settings: 'Настройки', done: 'Готово', provider: 'Провайдер', providerTab: 'Провайдер', interfaceTab: 'Интерфейс', apiKey: 'API-ключ', apiEndpoint: 'API endpoint', officialHint: 'пусто — официальный API',
      baseUrl: 'Базовый URL', trustApi: 'Я доверяю этому адресу для API-запросов', sendBearer: 'Отправлять API-ключ как Bearer-токен',
      apiKeys: 'API-ключи', storedLocally: 'хранятся локально в cue-data.json', models: 'Модели', modelHint: 'быстрый = Smart выкл. · умный = Smart вкл.',
      fastModel: 'Быстрая', smartModel: 'Умная', transcription: 'Маршрут расшифровки', separateFromChat: 'отдельно от чата',
      useForSpeech: 'Использовать провайдер для распознавания речи', sttKey: 'Ключ STT', sendSttBearer: 'Отправлять STT-ключ как Bearer-токен',
      sttModel: 'Модель STT', sttUrl: 'URL STT', sttProtocol: 'Протокол STT', trustAudio: 'Я доверяю этому адресу для API-ключа и аудио', appearance: 'Внешний вид',
      language: 'Язык интерфейса', windowDrag: 'Перетаскивать окно Cue', backgroundColor: 'Фон', accentColor: 'Акцент', opacity: 'Прозрачность', textSize: 'Размер текста', blurStrength: 'Размытие', cornerRadius: 'Скругление', animations: 'Анимации интерфейса', themes: 'Готовые темы', themeGraphite: 'Графит', themeMidnight: 'Полночь', themeObsidian: 'Обсидиан', themeArctic: 'Арктика', themeForest: 'Лес', themeWine: 'Вино', glassAppearance: 'Стекло и цвета', layout: 'Размер текста', behavior: 'Поведение', resetAppearance: 'Сбросить оформление',
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
    setTooltip(button, label);
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
    if (settingsButton) setTooltip(settingsButton, t('settings'));
    const hideButton = $('#hide-btn');
    if (hideButton) {
      const collapsed = $('#panel').classList.contains('collapsed');
      const panelLabel = collapsed
        ? (language === 'ru' ? 'Показать основное окно' : 'Show main window')
        : (language === 'ru' ? 'Скрыть основное окно' : 'Hide main window');
      setTooltip(hideButton, panelLabel);
      hideButton.setAttribute('aria-label', panelLabel);
    }
    const onboardButton = $('#logo-btn');
    if (onboardButton) {
      const onboardLabel = language === 'ru' ? 'Открыть знакомство с Cue' : 'Open Cue introduction';
      setTooltip(onboardButton, onboardLabel);
      onboardButton.setAttribute('aria-label', onboardLabel);
    }
    const copyButton = $('#copy-btn');
    if (copyButton) { setTooltip(copyButton, t('copy')); copyButton.setAttribute('aria-label', t('copy')); }
    const sendButton = $('#send-btn');
    if (sendButton) setTooltip(sendButton, language === 'ru' ? 'Отправить' : 'Send');
    setTooltip($('#smart-toggle'), language === 'ru'
      ? 'Использует более сильную модель для сложных вопросов. Ответ может занять немного больше времени.'
      : 'Uses a stronger model for complex questions. The answer may take a little longer.');
    customControls.forEach((sync) => sync());
    renderCaptureControl($('#stop-btn').classList.contains('active'));
  }

  function hexToRgb(hex) {
    const value = /^#([0-9a-f]{6})$/i.exec(String(hex || ''));
    if (!value) return [20, 22, 28];
    return [parseInt(value[1].slice(0, 2), 16), parseInt(value[1].slice(2, 4), 16), parseInt(value[1].slice(4, 6), 16)];
  }

  function applyAppearance() {
    const appearance = settings && settings.appearance ? settings.appearance : { language: 'ru', windowDrag: true, backgroundColor: '#14161c', accentColor: '#3c83f5', backgroundOpacity: 0.72, blurStrength: 40, cornerRadius: 24, animations: true, textScale: 1, panelWidth: 624, catalogWidth: 440, settingsWidth: 440, panelHeight: 540, catalogHeight: 690, settingsHeight: 690, panelOffsetY: 0, catalogTop: 14, settingsTop: 14 };
    const [r, g, b] = hexToRgb(appearance.backgroundColor);
    const opacity = Math.min(0.98, Math.max(0.2, Number(appearance.backgroundOpacity) || 0.72));
    document.documentElement.style.setProperty('--glass-bg', `rgba(${r}, ${g}, ${b}, ${opacity})`);
    document.documentElement.style.setProperty('--accent', appearance.accentColor || '#3c83f5');
    document.documentElement.style.setProperty('--accent-hi', appearance.accentColor || '#3c83f5');
    document.documentElement.style.setProperty('--glass-blur', `${appearance.blurStrength ?? 40}px`);
    document.documentElement.style.setProperty('--r-panel', `${appearance.cornerRadius || 24}px`);
    document.documentElement.style.setProperty('--text-zoom', String(appearance.textScale || 1));
    document.documentElement.style.setProperty('--panel-width', `${appearance.panelWidth || 624}px`);
    document.documentElement.style.setProperty('--catalog-width', `${appearance.catalogWidth || appearance.sidecarWidth || 440}px`);
    document.documentElement.style.setProperty('--settings-width', `${appearance.settingsWidth || appearance.sidecarWidth || 440}px`);
    document.documentElement.style.setProperty('--panel-height', `${appearance.panelHeight || 540}px`);
    document.documentElement.style.setProperty('--catalog-height', `${appearance.catalogHeight || 690}px`);
    document.documentElement.style.setProperty('--settings-height', `${appearance.settingsHeight || 690}px`);
    document.documentElement.style.setProperty('--panel-offset-y', `${appearance.panelOffsetY || 0}px`);
    document.documentElement.style.setProperty('--catalog-top', `${appearance.catalogTop ?? 14}px`);
    document.documentElement.style.setProperty('--settings-top', `${appearance.settingsTop ?? 14}px`);
    document.documentElement.dataset.animations = appearance.animations === false ? 'off' : 'on';
    $('#app').classList.toggle('drag-enabled', appearance.windowDrag !== false);
    const opacityInput = $('#appearance-opacity');
    const opacityValue = $('#appearance-opacity-value');
    if (opacityInput) opacityInput.value = String(Math.round(opacity * 100));
    if (opacityValue) opacityValue.textContent = Math.round(opacity * 100) + '%';
    const colorInput = $('#appearance-color');
    if (colorInput) colorInput.value = appearance.backgroundColor;
    const accentInput = $('#appearance-accent');
    if (accentInput) accentInput.value = appearance.accentColor || '#3c83f5';
    const blurInput = $('#appearance-blur');
    const blurValue = $('#appearance-blur-value');
    if (blurInput) blurInput.value = String(appearance.blurStrength ?? 40);
    if (blurValue) blurValue.textContent = String(appearance.blurStrength ?? 40);
    const radiusInput = $('#appearance-radius');
    const radiusValue = $('#appearance-radius-value');
    if (radiusInput) radiusInput.value = String(appearance.cornerRadius || 24);
    if (radiusValue) radiusValue.textContent = String(appearance.cornerRadius || 24);
    const textScaleInput = $('#appearance-text-scale');
    const textScaleValue = $('#appearance-text-scale-value');
    const textPixels = Math.round((appearance.textScale || 1) * 16);
    if (textScaleInput) textScaleInput.value = String(textPixels);
    if (textScaleValue) textScaleValue.textContent = textPixels + ' px';
    const animationsInput = $('#appearance-animations');
    if (animationsInput) animationsInput.checked = appearance.animations !== false;
    customControls.forEach((sync) => sync());
  }

  function captureAppearanceFields() {
    if (!settings.appearance) settings.appearance = {};
    settings.appearance.language = $('#appearance-language').value === 'en' ? 'en' : 'ru';
    settings.appearance.windowDrag = !!$('#appearance-drag').checked;
    settings.appearance.backgroundColor = /^#[0-9a-f]{6}$/i.test($('#appearance-color').value) ? $('#appearance-color').value.toLowerCase() : '#14161c';
    settings.appearance.accentColor = /^#[0-9a-f]{6}$/i.test($('#appearance-accent').value) ? $('#appearance-accent').value.toLowerCase() : '#3c83f5';
    settings.appearance.backgroundOpacity = Math.min(0.98, Math.max(0.2, Number($('#appearance-opacity').value || 72) / 100));
    settings.appearance.blurStrength = Math.min(60, Math.max(0, Number($('#appearance-blur').value || 40)));
    settings.appearance.cornerRadius = Math.min(32, Math.max(10, Number($('#appearance-radius').value || 24)));
    settings.appearance.animations = !!$('#appearance-animations').checked;
    settings.appearance.textScale = Math.min(1.5, Math.max(0.75, Number($('#appearance-text-scale').value || 16) / 16));
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
    speaker.textContent = turn.speaker || (currentLanguage() === 'ru' ? (turn.channel === 'them' ? 'Собеседник' : 'Вы') : (turn.channel === 'them' ? 'Them' : 'You'));
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
    const label = collapsed
      ? (currentLanguage() === 'ru' ? 'Показать основное окно' : 'Show main window')
      : (currentLanguage() === 'ru' ? 'Скрыть основное окно' : 'Hide main window');
    setTooltip($('#hide-btn'), label);
    $('#hide-btn').setAttribute('aria-label', label);
  });

  // Stop = start/stop listening. Kick off system-audio capture straight from the click so
  // the user-gesture is fresh for getDisplayMedia (loopback capture needs it).
  let captureTogglePending = false;
  let captureWanted = false;
  const captureHealth = { mic: 'idle', system: 'idle' };
  const captureMetrics = { micBytes: 0, systemBytes: 0, stt: 'idle', disk: 'idle', provider: '' };
  const usefulAudioAt = { mic: 0, system: 0 };
  let silenceWarnedAt = 0;
  let micVisualLevel = 0;
  let micVisualTarget = 0;
  let micVisualFrame = 0;

  function renderMicActivity() {
    micVisualFrame = 0;
    const rising = micVisualTarget > micVisualLevel;
    micVisualLevel += (micVisualTarget - micVisualLevel) * (rising ? 0.58 : 0.2);
    micVisualTarget *= 0.78;
    const profiles = [0.48, 0.78, 1, 0.7, 0.44];
    document.querySelectorAll('#mic-activity .mic-wave i').forEach((bar, index) => {
      const scale = 0.18 + micVisualLevel * profiles[index] * 0.82;
      bar.style.transform = `scaleY(${scale.toFixed(3)})`;
    });
    if (micVisualLevel > 0.012 || micVisualTarget > 0.012) micVisualFrame = requestAnimationFrame(renderMicActivity);
  }

  function setMicActivityLevel(rms) {
    const normalized = captureWanted ? Math.min(1, Math.sqrt(Math.max(0, rms - 100) / 5000)) : 0;
    micVisualTarget = Math.max(micVisualTarget, normalized);
    if (!micVisualFrame) micVisualFrame = requestAnimationFrame(renderMicActivity);
  }

  function formatBytes(value) { return value < 1024 * 1024 ? `${Math.round(value / 1024)} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`; }
  function setDiag(id, state, text) {
    const el = $(id);
    el.className = `diag-pill ${state || 'idle'}`;
    el.textContent = text;
  }
  function renderDiagnostics() {
    setDiag('#diag-mic', captureHealth.mic, `Микрофон ${formatBytes(captureMetrics.micBytes)}`);
    setDiag('#diag-system', captureHealth.system, `Система ${formatBytes(captureMetrics.systemBytes)}`);
    const sttLabels = { idle: 'STT ожидание', working: 'STT обработка', ok: `STT ${captureMetrics.provider || 'готов'}`, error: 'STT ошибка' };
    const diskLabels = { idle: 'Диск ожидание', ok: 'Диск сохранено', error: 'Диск ошибка' };
    setDiag('#diag-stt', captureMetrics.stt, sttLabels[captureMetrics.stt] || 'STT');
    setDiag('#diag-disk', captureMetrics.disk, diskLabels[captureMetrics.disk] || 'Диск');
  }
  function pcmRms(arrayBuffer) {
    const samples = new Int16Array(arrayBuffer);
    if (!samples.length) return 0;
    let sum = 0;
    for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
    return Math.sqrt(sum / samples.length);
  }
  function noteAudio(channel, data) {
    captureMetrics[channel === 'mic' ? 'micBytes' : 'systemBytes'] += data.byteLength || 0;
    const rms = pcmRms(data);
    if (rms >= 240) usefulAudioAt[channel] = Date.now();
    if (channel === 'mic') setMicActivityLevel(rms);
    renderDiagnostics();
  }
  setInterval(() => {
    if (!captureWanted) return;
    const latest = Math.max(usefulAudioAt.mic, usefulAudioAt.system);
    if (latest && Date.now() - latest < 45000) return;
    if (Date.now() - silenceWarnedAt < 45000) return;
    silenceWarnedAt = Date.now();
    showStatus('Внимание: 45 секунд нет полезного сигнала ни с микрофона, ни из системного звука.');
  }, 10000);

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
    const micActivity = $('#mic-activity');
    const micState = !captureWanted ? 'idle' : captureHealth.mic;
    micActivity.classList.toggle('idle', micState === 'idle');
    micActivity.classList.toggle('starting', micState === 'starting');
    micActivity.classList.toggle('recording', micState === 'ok');
    micActivity.classList.toggle('error', micState === 'error');
    const micStatus = micState === 'ok' ? 'запись идёт' : micState === 'starting' ? 'подключение' : micState === 'error' ? 'ошибка' : 'запись выключена';
    micActivity.setAttribute('aria-label', `Микрофон: ${micStatus}`);
    if (!captureWanted) setMicActivityLevel(0);
    renderDiagnostics();
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

  $('#finish-raw-btn').addEventListener('click', async () => {
    if (captureTogglePending) return;
    captureTogglePending = true;
    try {
      if (captureWanted) { stopMic(); stopSystemAudio(); }
      await cue.captureFinishRaw();
    } catch (err) {
      showStatus('Не удалось сохранить RAW: ' + mediaErrorDetail(err));
    } finally {
      captureTogglePending = false;
    }
  });

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
        proc.port.onmessage = (e) => { noteAudio('mic', e.data); cue.micPcm(e.data); };
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
        proc.port.onmessage = (e) => { noteAudio('system', e.data); cue.systemPcm(e.data); };
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
    if (active) {
      captureMetrics.micBytes = 0; captureMetrics.systemBytes = 0; captureMetrics.stt = 'idle'; captureMetrics.disk = 'idle'; captureMetrics.provider = '';
      usefulAudioAt.mic = Date.now(); usefulAudioAt.system = Date.now(); silenceWarnedAt = 0;
      void startMic(); void startSystemAudio(); clearMessages(); clearLiveTranscript(); assistStateEl.textContent = t('listening');
    } else { stopMic(); stopSystemAudio(); assistStateEl.textContent = t('ready'); }
    updateCaptureHealth();
  });
  cue.on('transcript', appendTranscript);
  cue.on('diagnostics', (data) => {
    if (data.stt) captureMetrics.stt = data.stt;
    if (data.disk) captureMetrics.disk = data.disk;
    if (data.sttProvider) captureMetrics.provider = data.sttProvider;
    renderDiagnostics();
  });
  cue.on('session:loaded', ({ transcript }) => {
    clearLiveTranscript();
    for (const turn of transcript || []) appendTranscript(turn);
  });
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
      document.getElementById('panel-scroll').appendChild(el);
    }
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => el.classList.remove('show'), 11000);
  }
  cue.on('status', ({ message }) => { cue.log('[status] ' + message); showStatus(message); });

  function renderRecovery(sessions) {
    const panel = $('#recovery-panel');
    const list = $('#recovery-list');
    const items = Array.isArray(sessions) ? sessions : [];
    panel.classList.toggle('hidden', items.length === 0);
    $('#recovery-count').textContent = items.length ? String(items.length) : '';
    list.innerHTML = '';
    for (const session of items) {
      const row = document.createElement('div');
      row.className = 'recovery-item';
      const info = document.createElement('div');
      info.className = 'recovery-info';
      const name = document.createElement('div');
      name.className = 'recovery-name';
      name.textContent = 'Встреча без итога';
      const meta = document.createElement('div');
      meta.className = 'recovery-meta';
      const when = new Date(session.startedAt || session.updatedAt || Date.now()).toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      const turns = Number(session.turnCount || 0);
      const errors = Number(session.errorCount || 0);
      meta.textContent = `${when} · ${turns} ${turns === 1 ? 'реплика' : 'реплик'}${errors ? ` · ${errors} ${errors === 1 ? 'ошибка' : 'ошибки'}` : ''}`;
      const actions = document.createElement('div');
      actions.className = 'recovery-actions';
      const add = (label, busyLabel, kind, action, iconName) => {
        const button = document.createElement('button');
        const renderIdle = () => {
          if (iconName) button.innerHTML = icon(iconName, { size: 14 });
          else button.textContent = label;
        };
        renderIdle();
        button.setAttribute('aria-label', label);
        button.title = label;
        if (iconName) button.classList.add('icon-only');
        if (kind) button.classList.add(kind);
        button.addEventListener('click', async () => {
          button.disabled = true;
          if (!iconName) button.textContent = busyLabel;
          button.classList.add('is-loading');
          try { await action(); renderRecovery(await cue.sessionsList()); }
          catch (error) { button.classList.add('is-error'); if (!iconName) button.textContent = 'Ошибка'; showStatus('Не удалось обработать черновик: ' + mediaErrorDetail(error)); }
          finally { button.disabled = false; button.classList.remove('is-loading'); if (button.isConnected) renderIdle(); }
        });
        actions.appendChild(button);
      };
      add('Продолжить', 'Запускаю…', 'primary', async () => { captureWanted = true; void startSystemAudio(); await cue.sessionContinue(session.filePath); });
      add('Итог', 'Формирую…', '', () => cue.sessionSummary(session.filePath));
      add('RAW', 'Открываю…', '', () => cue.sessionOpen(session.filePath));
      add('Убрать', 'Убираю…', 'dismiss', async () => { await cue.sessionDismiss(session.filePath); showStatus('Черновик убран из восстановления. RAW-файл сохранён.'); }, 'x');
      info.append(name, meta);
      row.append(info, actions);
      list.appendChild(row);
    }
  }
  cue.on('recovery:available', ({ sessions }) => renderRecovery(sessions));

  const catalogScrim = $('#catalog-scrim');
  const catalogQuery = $('#catalog-query');
  const catalogResults = $('#catalog-results');
  let catalogTimer = null;
  async function renderCatalog() {
    const items = await cue.catalogSearch(catalogQuery.value.trim());
    catalogResults.innerHTML = '';
    if (!items.length) { const empty = document.createElement('div'); empty.className = 'catalog-empty'; empty.textContent = 'Встречи не найдены'; catalogResults.appendChild(empty); return; }
    for (const item of items) {
      const row = document.createElement('div'); row.className = 'catalog-item';
      const title = document.createElement('div'); title.className = 'catalog-title'; title.textContent = item.title;
      const meta = document.createElement('div'); meta.className = 'catalog-meta'; meta.textContent = `${new Date(item.date).toLocaleString()}${item.client ? ' · ' + item.client : ''}${item.tags.length ? ' · ' + item.tags.join(', ') : ''}`;
      const snippet = document.createElement('div'); snippet.className = 'catalog-snippet'; snippet.textContent = item.snippet;
      const actions = document.createElement('div'); actions.className = 'catalog-actions';
      const add = (label, busyLabel, doneLabel, kind, fn) => {
        const button = document.createElement('button');
        button.textContent = label;
        button.className = `catalog-action ${kind}`;
        button.addEventListener('click', async () => {
          if (button.disabled) return;
          button.disabled = true;
          button.setAttribute('aria-busy', 'true');
          button.classList.add('is-loading');
          button.textContent = busyLabel;
          row.classList.add('is-busy');
          try {
            await fn();
            button.classList.remove('is-loading');
            button.classList.add('is-success');
            button.textContent = doneLabel;
            row.classList.add('is-success');
            setTimeout(() => { button.classList.remove('is-success'); button.textContent = label; row.classList.remove('is-success'); }, 1400);
          } catch (error) {
            button.classList.remove('is-loading');
            button.classList.add('is-error');
            button.textContent = 'Ошибка';
            row.classList.add('is-error');
            showStatus('Каталог: ' + mediaErrorDetail(error));
            setTimeout(() => { button.classList.remove('is-error'); button.textContent = label; row.classList.remove('is-error'); }, 2200);
          } finally {
            button.disabled = false;
            button.removeAttribute('aria-busy');
            row.classList.remove('is-busy');
          }
        });
        actions.appendChild(button);
      };
      add('Открыть', 'Открываю…', 'Открыто', 'primary', () => cue.catalogOpen(item.filePath));
      add('DOCX', 'DOCX…', 'Готово', 'format', () => cue.catalogExport(item.filePath, 'docx'));
      add('PDF', 'PDF…', 'Готово', 'format', () => cue.catalogExport(item.filePath, 'pdf'));
      row.append(title, meta, snippet, actions); catalogResults.appendChild(row);
    }
  }
  $('#search-btn').addEventListener('click', async () => {
    const opening = catalogScrim.classList.contains('hidden');
    catalogScrim.classList.toggle('hidden', !opening);
    $('#search-btn').classList.toggle('on', opening);
    if (opening) { await renderCatalog(); catalogQuery.focus(); }
  });
  $('#catalog-close').addEventListener('click', () => {
    catalogScrim.classList.add('hidden');
    $('#search-btn').classList.remove('on');
  });
  catalogQuery.addEventListener('input', () => { clearTimeout(catalogTimer); catalogTimer = setTimeout(() => void renderCatalog(), 180); });

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

  function showSettingsTab(name) {
    const tab = name === 'interface' ? 'interface' : 'provider';
    document.querySelectorAll('[data-settings-tab]').forEach((button) => {
      const active = button.dataset.settingsTab === tab;
      button.classList.toggle('on', active);
      button.setAttribute('aria-selected', String(active));
    });
    $('#settings-provider-pane').classList.toggle('hidden', tab !== 'provider');
    $('#settings-interface-pane').classList.toggle('hidden', tab !== 'interface');
  }
  document.querySelectorAll('[data-settings-tab]').forEach((button) => button.addEventListener('click', () => showSettingsTab(button.dataset.settingsTab)));

  function openSettings() {
    if (!settings) return;
    closeOnboard();
    fillSettings();
    showSettingsTab('provider');
    scrim.classList.remove('hidden');
    $('#more-btn').classList.add('on');
  }
  async function closeSettings() {
    if (settingsSaving) return;
    settingsSaving = true;
    const saved = await saveSettings();
    settingsSaving = false;
    if (saved) {
      scrim.classList.add('hidden');
      $('#more-btn').classList.remove('on');
    }
  }
  $('#more-btn').addEventListener('click', () => {
    if (scrim.classList.contains('hidden')) openSettings();
    else void closeSettings();
  });
  $('#s-close').addEventListener('click', closeSettings);
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
    settings.appearance.accentColor = /^#[0-9a-f]{6}$/i.test(settings.appearance.accentColor || '') ? settings.appearance.accentColor.toLowerCase() : '#3c83f5';
    const appearanceOpacity = Number(settings.appearance.backgroundOpacity);
    settings.appearance.backgroundOpacity = Number.isFinite(appearanceOpacity) ? Math.min(0.98, Math.max(0.2, appearanceOpacity)) : 0.72;
    const appearanceTextScale = Number(settings.appearance.textScale);
    settings.appearance.textScale = Number.isFinite(appearanceTextScale) ? Math.min(1.5, Math.max(0.75, appearanceTextScale)) : 1;
    const appearancePanelWidth = Number(settings.appearance.panelWidth);
    settings.appearance.panelWidth = Number.isFinite(appearancePanelWidth) ? Math.min(760, Math.max(520, appearancePanelWidth)) : 624;
    const appearanceSidecarWidth = Number(settings.appearance.sidecarWidth);
    settings.appearance.sidecarWidth = Number.isFinite(appearanceSidecarWidth) ? Math.min(520, Math.max(300, appearanceSidecarWidth)) : 440;
    const clampAppearance = (key, fallback, min, max) => {
      const value = Number(settings.appearance[key]);
      settings.appearance[key] = Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
    };
    clampAppearance('catalogWidth', settings.appearance.sidecarWidth, 300, 520);
    clampAppearance('settingsWidth', settings.appearance.sidecarWidth, 300, 520);
    clampAppearance('panelHeight', 540, 280, 900);
    clampAppearance('catalogHeight', 690, 320, 1100);
    clampAppearance('settingsHeight', 690, 320, 1100);
    clampAppearance('panelOffsetY', 0, -8, 220);
    clampAppearance('catalogTop', 14, 4, 260);
    clampAppearance('settingsTop', 14, 4, 260);
    settings.appearance.blurStrength = Number.isFinite(Number(settings.appearance.blurStrength)) ? Math.min(60, Math.max(0, Number(settings.appearance.blurStrength))) : 40;
    settings.appearance.cornerRadius = Number.isFinite(Number(settings.appearance.cornerRadius)) ? Math.min(32, Math.max(10, Number(settings.appearance.cornerRadius))) : 24;
    settings.appearance.animations = settings.appearance.animations !== false;
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
    $('#provider-select').value = settings.provider;
    $('#appearance-language').value = settings.appearance.language;
    $('#appearance-drag').checked = settings.appearance.windowDrag;
    $('#appearance-color').value = settings.appearance.backgroundColor;
    $('#appearance-accent').value = settings.appearance.accentColor;
    $('#appearance-opacity').value = String(Math.round(settings.appearance.backgroundOpacity * 100));
    $('#appearance-opacity-value').textContent = Math.round(settings.appearance.backgroundOpacity * 100) + '%';
    $('#appearance-text-scale').value = String(Math.round(settings.appearance.textScale * 16));
    $('#appearance-text-scale-value').textContent = Math.round(settings.appearance.textScale * 16) + ' px';
    $('#appearance-blur').value = String(settings.appearance.blurStrength);
    $('#appearance-blur-value').textContent = String(settings.appearance.blurStrength);
    $('#appearance-radius').value = String(settings.appearance.cornerRadius);
    $('#appearance-radius-value').textContent = String(settings.appearance.cornerRadius);
    $('#appearance-animations').checked = settings.appearance.animations;
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
    $('#provider-api-key').value = settings.apiKeys[provider] || '';
    $('#provider-api-key').placeholder = provider === 'anthropic' ? 'sk-ant-...' : provider === 'gemini' ? 'AIza...' : provider === 'nvidia' ? 'nvapi-...' : provider === 'compatible' ? 'optional with no auth' : 'sk-...';
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
    settings.apiKeys[provider] = $('#provider-api-key').value.trim();
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
  $('#appearance-accent').addEventListener('input', () => { captureAppearanceFields(); applyAppearance(); });
  $('#appearance-opacity').addEventListener('input', () => { captureAppearanceFields(); applyAppearance(); });
  $('#appearance-blur').addEventListener('input', () => { captureAppearanceFields(); applyAppearance(); });
  $('#appearance-radius').addEventListener('input', () => { captureAppearanceFields(); applyAppearance(); });
  $('#appearance-text-scale').addEventListener('input', () => { captureAppearanceFields(); applyAppearance(); });
  $('#appearance-animations').addEventListener('change', () => { captureAppearanceFields(); applyAppearance(); });
  const appearancePresets = {
    graphite: { backgroundColor: '#14161c', accentColor: '#3c83f5', backgroundOpacity: 0.72, blurStrength: 40, cornerRadius: 24 },
    midnight: { backgroundColor: '#101827', accentColor: '#7c8cff', backgroundOpacity: 0.82, blurStrength: 46, cornerRadius: 22 },
    obsidian: { backgroundColor: '#08090c', accentColor: '#d5a85b', backgroundOpacity: 0.9, blurStrength: 28, cornerRadius: 18 },
    arctic: { backgroundColor: '#18202b', accentColor: '#7dd3fc', backgroundOpacity: 0.8, blurStrength: 44, cornerRadius: 24 },
    forest: { backgroundColor: '#101b18', accentColor: '#34d399', backgroundOpacity: 0.84, blurStrength: 38, cornerRadius: 22 },
    wine: { backgroundColor: '#21131a', accentColor: '#fb7185', backgroundOpacity: 0.84, blurStrength: 42, cornerRadius: 24 }
  };
  document.querySelectorAll('#appearance-presets [data-preset]').forEach((button) => button.addEventListener('click', () => {
    settings.appearance = { ...settings.appearance, ...appearancePresets[button.dataset.preset] };
    applyAppearance();
  }));
  $('#appearance-reset').addEventListener('click', () => {
    settings.appearance = { ...settings.appearance, backgroundColor: '#14161c', accentColor: '#3c83f5', backgroundOpacity: 0.72, blurStrength: 40, cornerRadius: 24, animations: true, textScale: 1 };
    applyAppearance();
  });

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
  $('#provider-select').addEventListener('change', (event) => {
    captureProviderFields(settings.provider);
    settings.provider = event.target.value;
    fillProviderFields(settings.provider);
    $('#s-status').textContent = statusText();
  });

  function settingsValidationError(message, provider, field) {
    const error = new Error(message);
    error.provider = provider;
    error.field = field;
    return error;
  }

  async function saveSettings() {
    captureAppearanceFields();
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
        $('#provider-select').value = settings.provider;
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

  // ---- global keys -------------------------------------------------------
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !scrim.classList.contains('hidden')) closeSettings();
    if (isCmdOrCtrl(e)) {
      if (e.key === ',') { e.preventDefault(); openSettings(); }
    }
  });

  function bindPanelResizer(handle) {
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const startX = event.clientX;
      const startY = event.clientY;
      const startPanel = Number(settings.appearance.panelWidth) || 624;
      const panelEdge = handle.dataset.resizePanel;
      const sidecar = handle.dataset.resizeSidecar;
      const heightTarget = handle.dataset.resizeHeight;
      const edge = handle.dataset.resizeEdge || panelEdge;
      const widthKey = sidecar ? `${sidecar}Width` : null;
      const heightKey = heightTarget ? `${heightTarget}Height` : null;
      const topKey = heightTarget === 'panel' ? 'panelOffsetY' : (heightTarget ? `${heightTarget}Top` : null);
      const startWidth = widthKey ? Number(settings.appearance[widthKey]) || 440 : 0;
      const startHeight = heightKey ? Number(settings.appearance[heightKey]) || (heightTarget === 'panel' ? 540 : 690) : 0;
      const startTop = topKey ? Number(settings.appearance[topKey]) || 0 : 0;
      handle.classList.add('dragging');
      document.body.classList.add('resizing-panels');
      document.body.dataset.resizeAxis = heightTarget ? 'y' : 'x';
      handle.setPointerCapture(event.pointerId);
      const move = (moveEvent) => {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        if (panelEdge) {
          const direction = panelEdge === 'right' ? 1 : -1;
          settings.appearance.panelWidth = Math.min(760, Math.max(520, Math.round((startPanel + direction * dx * 2) / 4) * 4));
        } else if (sidecar) {
          const direction = edge === 'right' ? 1 : -1;
          settings.appearance[widthKey] = Math.min(520, Math.max(300, Math.round((startWidth + direction * dx) / 4) * 4));
        } else if (heightTarget) {
          const minHeight = heightTarget === 'panel' ? 280 : 320;
          const available = Math.max(minHeight, window.innerHeight - (edge === 'top' ? Math.max(4, startTop + dy) : startTop) - 8);
          settings.appearance[heightKey] = Math.min(available, Math.max(minHeight, Math.round((startHeight + (edge === 'top' ? -dy : dy)) / 4) * 4));
          if (edge === 'top') settings.appearance[topKey] = Math.max(heightTarget === 'panel' ? -8 : 4, Math.min(260, Math.round(startTop + dy)));
        }
        applyAppearance();
      };
      const finish = async () => {
        handle.classList.remove('dragging');
        document.body.classList.remove('resizing-panels');
        delete document.body.dataset.resizeAxis;
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', finish);
        handle.removeEventListener('pointercancel', finish);
        const layout = { panelWidth: settings.appearance.panelWidth };
        if (widthKey) layout[widthKey] = settings.appearance[widthKey];
        if (heightKey) layout[heightKey] = settings.appearance[heightKey];
        if (topKey) layout[topKey] = settings.appearance[topKey];
        settings = await cue.settingsSet({ appearance: layout });
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', finish);
      handle.addEventListener('pointercancel', finish);
    });
  }
  document.querySelectorAll('.panel-resizer').forEach(bindPanelResizer);

  // ---- click-through: only the UI blocks the mouse; empty gaps pass to your screen ----
  let ignoring = null;
  function setIgnore(v) { if (v !== ignoring) { ignoring = v; cue.setIgnoreMouse(v); } }
  document.addEventListener('mousemove', (e) => {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const overUI = !!(el && el.closest && el.closest('#toolbar, #panel-wrap, #settings, #catalog, #onboard, .panel-resizer'));
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
  function showOnboard() {
    obIndex = 0;
    renderOnboard();
    obScrim.classList.remove('hidden');
    $('#logo-btn').classList.add('on');
    setIgnore(false);
  }
  function closeOnboard() {
    obScrim.classList.add('hidden');
    $('#logo-btn').classList.remove('on');
  }
  async function toggleOnboard() {
    if (!obScrim.classList.contains('hidden')) { closeOnboard(); return; }
    if (!scrim.classList.contains('hidden')) {
      await closeSettings();
      if (!scrim.classList.contains('hidden')) return;
    }
    showOnboard();
  }
  async function finishOnboard() {
    closeOnboard();
    if (settings && !settings.onboarded) { settings.onboarded = true; await cue.settingsSet({ onboarded: true }); }
  }
  $('#ob-next').addEventListener('click', () => { if (obIndex === OB_STEPS.length - 1) finishOnboard(); else { obIndex++; renderOnboard(); } });
  $('#ob-back').addEventListener('click', () => { if (obIndex > 0) { obIndex--; renderOnboard(); } });
  $('#ob-skip').addEventListener('click', finishOnboard);
  $('#logo-btn').addEventListener('click', () => void toggleOnboard());

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
    clearMessages();
    syncPlaceholder();
    const st = await cue.captureState();
    captureWanted = !!st.active;
    renderCaptureControl(!!st.active);
    if (st.active) { void startMic(); void startSystemAudio(); }
    updateCaptureHealth();
    renderRecovery(await cue.sessionsList());
    if (!settings.onboarded) showOnboard();

    if (cue.platform === 'win32') {
      const keycaps = document.querySelectorAll('#placeholder .keycap');
      if (keycaps.length > 0) keycaps[0].textContent = 'Ctrl';
    }
    applyLanguage();
  })();
})();
