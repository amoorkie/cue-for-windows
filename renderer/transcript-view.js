// Общая модель текста: основная панель показывает реплику, отдельное окно — всю историю.
// Группировка меняет только представление; сохранённые фрагменты и текст для ИИ не меняются.
window.CueTranscriptView = class {
  // Связываем действия двух представлений; чтение истории и прокрутку ведёт только её окно.
  constructor({ language, onCount }) {
    this.language = language;
    this.onCount = onCount;
    this.full = window.cue.surface === 'transcript';
    this.turns = new Map();
    this.recording = false;
    this.captureHealth = {};
    this.unread = 0;
    this.follow = true;
    this.$ = id => document.getElementById(id);
    this.$('transcript-preview-open').innerHTML = window.ICONS.icon('maximize-2', { size: 15 });
    this.$('transcript-copy').innerHTML = window.ICONS.icon('copy', { size: 16 });
    this.$('transcript-close').innerHTML = window.ICONS.icon('x', { size: 16 });
    this.$('transcript-preview').addEventListener('click', () => void window.cue.windowOpen('transcript'));
    this.$('transcript-close').addEventListener('click', () => void window.cue.windowClose());
    this.$('transcript-copy').addEventListener('click', () => void this.copy());
    this.$('transcript-latest').addEventListener('click', () => this.latest());
    if (this.full) {
      this.$('live-transcript').addEventListener('scroll', () => {
        const el = this.$('live-transcript');
        this.follow = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        if (this.follow) this.unread = 0;
        this.labels();
      });
      document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !document.body.matches('.dragging-surfaces, .resizing-panels')) void window.cue.windowClose();
      });
    }
    this.labels();
  }

  // Статус отражает включение записи, а при отказе звуковых каналов предупреждает пользователя.
  status() {
    const ru = this.language() === 'ru';
    if (!this.recording) return this.turns.size ? (ru ? 'Запись остановлена' : 'Recording stopped') : (ru ? 'Запись выключена' : 'Recording off');
    const channels = Object.values(this.captureHealth);
    if (!channels.includes('ok') && channels.includes('error')) return ru ? 'Проверьте звук' : 'Check audio';
    if (!channels.includes('ok') && channels.includes('starting')) return ru ? 'Подключаем звук…' : 'Connecting audio…';
    return ru ? 'Идёт запись' : 'Recording';
  }

  // Подписи обновляются без повторного создания истории и без объявления каждой фразы скринридеру.
  labels() {
    const ru = this.language() === 'ru';
    const status = this.status();
    const warning = this.recording && !Object.values(this.captureHealth).includes('ok') && Object.values(this.captureHealth).includes('error');
    this.$('transcript-preview').dataset.recording = String(this.recording);
    this.$('transcript-preview').dataset.warning = String(warning);
    this.$('transcript-preview').title = ru ? 'Открыть расшифровку в отдельном окне' : 'Open transcript in a separate window';
    this.$('transcript-preview').setAttribute('aria-label', `${this.$('transcript-preview').title}. ${status}`);
    this.$('transcript-preview-status').textContent = status;
    this.$('transcript-title').textContent = ru ? 'Расшифровка' : 'Transcript';
    this.$('transcript-state-label').textContent = status;
    this.$('transcript-box').dataset.recording = String(this.recording);
    this.$('transcript-empty').textContent = this.recording
      ? (ru ? 'Ожидаем речь…' : 'Waiting for speech…')
      : (ru ? 'Включите запись — здесь появится расшифровка разговора.' : 'Start recording to see the conversation transcript here.');
    for (const [id, label] of [['transcript-copy', ru ? 'Копировать расшифровку' : 'Copy transcript'], ['transcript-close', ru ? 'Закрыть расшифровку' : 'Close transcript']]) {
      this.$(id).title = label;
      this.$(id).setAttribute('aria-label', label);
    }
    this.$('transcript-copy').disabled = !this.turns.size;
    this.$('live-transcript').setAttribute('aria-label', ru ? 'Расшифровка разговора' : 'Conversation transcript');
    this.$('transcript-latest').classList.toggle('hidden', this.follow);
    this.$('transcript-latest').textContent = (ru ? 'К последним репликам' : 'Latest speech') + (this.unread ? ` · ${this.unread}` : '');
  }

  // Возвращаем слежение только по явному запросу; чтение старых фраз не прерывается.
  latest() {
    this.follow = true;
    this.unread = 0;
    requestAnimationFrame(() => { this.$('live-transcript').scrollTop = this.$('live-transcript').scrollHeight; });
    this.labels();
  }

  // Очистка относится к началу новой встречи; скрытие окна сохраняет историю и прокрутку.
  clear() {
    this.turns.clear(); this.unread = 0; this.follow = true;
    this.$('transcript-feedback').textContent = '';
    this.$('live-transcript').replaceChildren();
    this.render();
  }

  // Смена режима записи обновляет индикатор, сохраняя накопленные реплики.
  capture(active) { this.recording = active; this.labels(); }
  // Состояния каналов позволяют отличить включённую запись от отказа устройства.
  health(health) { this.captureHealth = { ...health }; this.labels(); }

  // Исправления распознавания заменяют фрагменты по ID и могут изменить последнюю реплику.
  update({ upserts = [], removed = [] }) {
    for (const id of removed) this.turns.delete(id);
    for (const turn of upserts) {
      if (!turn?.text) continue;
      const id = turn.id || `${turn.channel}:${turn.ts}:${turn.text}`;
      if (!this.turns.has(id) && !this.follow) this.unread++;
      this.turns.set(id, { ...turn, id });
    }
    this.render();
  }

  // Порядок определяется временем речи, а не очередностью ответов распознавания.
  ordered() { return [...this.turns.values()].sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id)); }
  // Подпись обозначает источник звука; она не идентифицирует человека по голосу.
  speaker(turn) { return this.language() === 'ru' ? (turn.channel === 'them' ? 'Собеседник' : 'Вы') : (turn.channel === 'them' ? 'Other participant' : 'You'); }
  // Для буфера обмена собираем исходные реплики, без визуальной группировки.
  text() { return this.ordered().map(turn => `${this.speaker(turn)}: ${turn.text}`).join('\n'); }

  // Копируется полный текст встречи; скрытые сообщения чата сюда не включаются.
  async copy() {
    try {
      await window.cue.copyText(this.text());
      this.$('transcript-feedback').textContent = this.language() === 'ru' ? 'Расшифровка скопирована' : 'Transcript copied';
    } catch {
      this.$('transcript-feedback').textContent = this.language() === 'ru' ? 'Не удалось скопировать. Выделите текст и скопируйте вручную.' : 'Copy failed. Select the text and copy it manually.';
    }
  }

  // В основной панели не создаём скрытую историю: это уменьшает работу при длинных встречах.
  render() {
    const turns = this.ordered();
    const last = turns.at(-1);
    this.$('transcript-preview-text').textContent = last ? `${this.speaker(last)}: ${last.text}`
      : (this.language() === 'ru' ? 'Здесь появится последняя реплика' : 'Your latest speech will appear here');
    this.onCount(this.turns.size);
    this.$('transcript-empty').hidden = !!this.turns.size;
    if (this.full) {
      const el = this.$('live-transcript');
      const scroll = el.scrollTop;
      const groups = [];
      for (const turn of turns) {
        const previous = groups.at(-1);
        if (previous && previous.channel === turn.channel && turn.ts - previous.endTs <= 2000 && previous.text.length + turn.text.length < 800) {
          previous.text += ' ' + turn.text; previous.endTs = turn.endTs || turn.ts; previous.ids.push(turn.id);
        } else groups.push({ ...turn, endTs: turn.endTs || turn.ts, ids: [turn.id] });
      }
      const fragment = document.createDocumentFragment();
      for (const group of groups) {
        const row = document.createElement('div'); row.className = `transcript-row ${group.channel}`; row.dataset.turnIds = JSON.stringify(group.ids);
        const meta = document.createElement('div'); meta.className = 'transcript-meta';
        const who = document.createElement('span'); who.className = 'transcript-speaker'; who.textContent = this.speaker(group);
        who.title = group.channel === 'them' ? (this.language() === 'ru' ? 'Системный звук' : 'System audio') : (this.language() === 'ru' ? 'Микрофон' : 'Microphone');
        const time = document.createElement('time'); time.className = 'transcript-time'; time.dateTime = new Date(group.ts).toISOString();
        time.textContent = new Date(group.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        meta.append(who, time);
        const text = document.createElement('div'); text.className = 'transcript-text'; text.textContent = group.text;
        row.append(meta, text); fragment.append(row);
      }
      el.replaceChildren(fragment);
      if (this.follow) this.latest(); else el.scrollTop = scroll;
    }
    this.labels();
  }
};
