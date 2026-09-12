// Reconcile two audio sources, not voice identities. Original recognitions are immutable.
const { rms16 } = require('./wav');

function cleanSpeakerMarkers(text) {
  return String(text || '').replace(/^\s*\[?SPEAKER[_ ]?\d+\]?\s*[:\-]?\s*/gim, '').trim();
}
function words(text) {
  return [...text.matchAll(/[\p{L}\p{N}]+/gu)].map(m => ({ value: m[0].toLowerCase().replace(/ё/g, 'е'), start: m.index, end: m.index + m[0].length }));
}
function overlapping(a, b) {
  // Legacy journals do not have an audio end time: never guess one for deduplication.
  if (!Number.isFinite(a.endTs) || !Number.isFinite(b.endTs)) return false;
  const intersection = Math.min(a.endTs, b.endTs) - Math.max(a.ts, b.ts);
  return intersection >= Math.min(150, Math.min(a.endTs - a.ts, b.endTs - b.ts) * 0.4);
}
function removeEchoWords(micText, remoteTexts) {
  const mic = words(micText);
  if (!mic.length) return { text: micText, matched: false };
  const removed = new Set();
  for (const remoteText of remoteTexts) {
    const remote = words(remoteText);
    for (let i = 0; i < mic.length; i++) {
      for (let j = 0; j < remote.length; j++) {
        let length = 0;
        while (mic[i + length] && remote[j + length] && mic[i + length].value === remote[j + length].value) length++;
        const fullMic = i === 0 && length === mic.length && micText.length >= 6;
        if (length >= 4 || (fullMic && length >= 2)) {
          for (let k = i; k < i + length; k++) removed.add(k);
        }
      }
    }
  }
  if (!removed.size) return { text: micText, matched: false };
  const spans = [];
  for (let i = 0; i < mic.length;) {
    if (removed.has(i)) { i++; continue; }
    const start = i;
    while (i < mic.length && !removed.has(i)) i++;
    // Preserve punctuation inside each retained span and at the original end.
    const end = i === mic.length ? micText.length : mic[i - 1].end;
    spans.push(micText.slice(mic[start].start, end).trim());
  }
  return { text: spans.join(' ').trim(), matched: true };
}

function reconcile(rawTurns) {
  const ordered = [...rawTurns].sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));
  const remotes = ordered.filter(turn => turn.channel === 'them');
  let firstRemote = 0;
  return ordered.flatMap(turn => {
    const text = cleanSpeakerMarkers(turn.text);
    if (!text) return [];
    const base = { ...turn, text, speaker: turn.channel === 'them' ? 'Собеседник' : 'Вы' };
    if (turn.channel !== 'you' || !Number.isFinite(turn.endTs)) return [base];
    while (firstRemote < remotes.length && Number.isFinite(remotes[firstRemote].endTs) && remotes[firstRemote].endTs < turn.ts) firstRemote++;
    const candidates = [];
    for (let i = firstRemote; i < remotes.length && remotes[i].ts <= turn.endTs; i++) {
      if (overlapping(turn, remotes[i])) candidates.push(remotes[i]);
    }
    const result = removeEchoWords(text, candidates.map(r => cleanSpeakerMarkers(r.text)));
    return result.text ? [{ ...base, text: result.text, ...(result.matched ? { echoSources: candidates.filter(r => removeEchoWords(text, [cleanSpeakerMarkers(r.text)]).matched).map(r => r.id) } : {}) }] : [];
  });
}

function speechRange(pcm, ts, gate = 240) {
  let first = -1, last = 0;
  for (let offset = 0; offset < pcm.length; offset += 640) {
    const frame = pcm.subarray(offset, Math.min(pcm.length, offset + 640));
    if (rms16(frame) >= gate) { if (first < 0) first = offset; last = offset + frame.length; }
  }
  return { ts: ts + Math.max(0, first) / 32, endTs: ts + (last || pcm.length) / 32 };
}

class TranscriptLedger {
  constructor() { this.reset(); }
  reset(turns = []) {
    this.source = turns.map((turn, i) => ({ ...turn, id: turn.id || `legacy-${i}`, source: turn.source || (turn.channel === 'them' ? 'system' : 'mic') }));
    this.turns = reconcile(this.source);
    this.revision = 0;
    return this.turns;
  }
  append(raw) {
    if (this.source.some(t => t.id === raw.id)) return { upserts: [], removed: [] };
    const previous = new Map(this.turns.map(t => [t.id, JSON.stringify(t)]));
    this.source.push({ ...raw });
    this.turns = reconcile(this.source);
    const current = new Set(this.turns.map(t => t.id));
    const upserts = this.turns.filter(t => previous.get(t.id) !== JSON.stringify(t));
    const removed = [...previous.keys()].filter(id => !current.has(id));
    this.revision++;
    return { upserts, removed };
  }
}

module.exports = { TranscriptLedger, cleanSpeakerMarkers, reconcile, speechRange, overlapping, removeEchoWords };
