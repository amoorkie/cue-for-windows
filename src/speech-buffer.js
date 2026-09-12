const { rms16 } = require('./wav');

// PCM16 mono at 16 kHz. Keep short phrases intact and cap continuous speech.
class SpeechBuffer {
  constructor({ maxSeconds = 30, gate = 240 } = {}) {
    this.maxBytes = maxSeconds * 32000;
    this.gate = gate;
    this.clear();
  }
  clear() { this.chunks = []; this.bytes = 0; this.silenceBytes = 0; this.startedAt = 0; }
  push(pcm, ts = Date.now()) {
    if (!pcm.length || pcm.length % 2) return;
    if (this.bytes + pcm.length > this.maxBytes) throw new Error('Запись остановлена: очередь расшифровки превысила 30 секунд. Последний фрагмент не принят.');
    if (!this.bytes) this.startedAt = ts;
    this.chunks.push(pcm);
    this.bytes += pcm.length;
    this.silenceBytes = rms16(pcm) < this.gate ? this.silenceBytes + pcm.length : 0;
  }
  take({ force = false, live = false } = {}) {
    if (!this.bytes) return null;
    if (!force && this.bytes < 9600) return null;
    if (live && !force && this.bytes < 4.4 * 32000 && this.silenceBytes < 0.4 * 32000) return null;
    const all = Buffer.concat(this.chunks, this.bytes);
    const length = Math.min(all.length, 8 * 32000);
    const pcm = all.subarray(0, length);
    const ts = this.startedAt;
    this.chunks = all.length > length ? [all.subarray(length)] : [];
    this.bytes = all.length - length;
    this.startedAt = this.bytes ? ts + length / 32 : 0;
    this.silenceBytes = Math.min(this.silenceBytes, this.bytes);
    return { pcm, ts };
  }
}

module.exports = { SpeechBuffer };
