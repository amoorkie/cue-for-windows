// Presentation grouping never changes stored turns or the text sent to the LLM.
window.CueTranscriptView = class {
  constructor({ language, onCount }) {
    this.language = language;
    this.onCount = onCount;
    this.turns = new Map();
    this.state = 'compact';
    this.unread = 0;
    this.follow = true;
    this.scrollTop = 0;
    this.$ = id => document.getElementById(id);
    this.$('transcript-toggle').addEventListener('click', () => this.setState(this.state === 'collapsed' ? 'compact' : 'collapsed'));
    this.$('transcript-expand').addEventListener('click', () => this.setState(this.state === 'full' ? 'compact' : 'full'));
    this.$('transcript-unread').addEventListener('click', () => { this.setState('compact'); this.latest(); });
    this.$('transcript-latest').addEventListener('click', () => this.latest());
    this.$('chat-unread').addEventListener('click', () => this.setState('compact'));
    this.$('live-transcript').addEventListener('scroll', () => {
      if (this.state === 'collapsed') return;
      const el = this.$('live-transcript');
      this.scrollTop = el.scrollTop;
      this.follow = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      if (this.follow) this.unread = 0;
      this.labels();
    });
    this.setState('compact');
  }
  setState(state) {
    if (this.state !== 'collapsed') this.scrollTop = this.$('live-transcript').scrollTop;
    this.state = state;
    this.$('panel').dataset.transcriptState = state;
    const collapsed = state === 'collapsed';
    this.$('transcript-toggle').setAttribute('aria-expanded', String(!collapsed));
    this.$('transcript-expand').setAttribute('aria-pressed', String(state === 'full'));
    this.$('live-transcript').hidden = collapsed;
    this.$('capture-diagnostics').hidden = collapsed;
    this.$('answer-view').hidden = state === 'full';
    if (state !== 'full') this.$('chat-unread').classList.add('hidden');
    if (!collapsed && this.follow) this.latest();
    else if (!collapsed) {
      const scroll = this.scrollTop;
      requestAnimationFrame(() => { this.$('live-transcript').scrollTop = scroll; });
    }
    this.labels();
  }
  labels() {
    const ru = this.language() === 'ru';
    this.$('transcript-title').textContent = ru ? 'Расшифровка' : 'Transcript';
    this.$('transcript-state-label').textContent = this.recording ? (ru ? 'Запись' : 'Recording') : (ru ? 'Сохранённый текст' : 'Saved text');
    this.$('transcript-expand').setAttribute('aria-label', this.state === 'full'
      ? (ru ? 'Вернуться к чату' : 'Return to chat') : (ru ? 'Развернуть расшифровку до поля ввода' : 'Expand transcript to the composer'));
    this.$('transcript-expand').innerHTML = window.ICONS.icon(this.state === 'full' ? 'minimize-2' : 'maximize-2', { size: 14 });
    this.$('transcript-unread').textContent = `${ru ? 'Новых' : 'New'}: ${this.unread}`;
    this.$('transcript-unread').classList.toggle('hidden', !this.unread || this.state !== 'collapsed');
    this.$('transcript-latest').classList.toggle('hidden', this.follow || this.state === 'collapsed');
    this.$('transcript-latest').textContent = ru ? 'К последним репликам' : 'Latest speech';
    this.$('chat-unread').textContent = ru ? 'Новый ответ в чате' : 'New chat response';
  }
  latest() {
    this.follow = true;
    this.unread = 0;
    requestAnimationFrame(() => { this.$('live-transcript').scrollTop = this.$('live-transcript').scrollHeight; });
    this.labels();
  }
  clear() {
    this.turns.clear(); this.unread = 0; this.follow = true; this.scrollTop = 0;
    this.$('live-transcript').replaceChildren();
    this.$('transcript-box').classList.toggle('hidden', !this.recording);
    this.onCount(0);
  }
  capture(active, initial) {
    this.recording = active;
    if (active && !initial) this.setState('compact');
    this.$('transcript-box').classList.toggle('hidden', !active && !this.turns.size);
    this.labels();
  }
  update({ upserts = [], removed = [] }) {
    for (const id of removed) this.turns.delete(id);
    for (const turn of upserts) {
      if (!turn?.text) continue;
      const id = turn.id || `${turn.channel}:${turn.ts}:${turn.text}`;
      if (!this.turns.has(id) && (this.state === 'collapsed' || !this.follow)) this.unread++;
      this.turns.set(id, { ...turn, id });
    }
    this.render();
  }
  ordered() { return [...this.turns.values()].sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id)); }
  speaker(turn) { return this.language() === 'ru' ? (turn.channel === 'them' ? 'Собеседник' : 'Вы') : (turn.channel === 'them' ? 'Other participant' : 'You'); }
  text() { return this.ordered().map(turn => `${this.speaker(turn)}: ${turn.text}`).join('\n'); }
  render() {
    const el = this.$('live-transcript');
    const scroll = this.state === 'collapsed' ? this.scrollTop : el.scrollTop;
    const groups = [];
    for (const turn of this.ordered()) {
      const last = groups.at(-1);
      if (last && last.channel === turn.channel && turn.ts - last.endTs <= 2000 && last.text.length + turn.text.length < 800) {
        last.text += ' ' + turn.text;
        last.endTs = turn.endTs || turn.ts;
        last.ids.push(turn.id);
      } else groups.push({ ...turn, endTs: turn.endTs || turn.ts, ids: [turn.id] });
    }
    const fragment = document.createDocumentFragment();
    for (const group of groups) {
      const row = document.createElement('div');
      row.className = `transcript-row ${group.channel}`;
      row.dataset.turnIds = JSON.stringify(group.ids);
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
    this.$('transcript-box').classList.toggle('hidden', !this.recording && !this.turns.size);
    this.onCount(this.turns.size);
    if (this.follow && this.state !== 'collapsed') this.latest(); else el.scrollTop = scroll;
    this.labels();
  }
};
