const fs = require('fs/promises');
const path = require('path');

function fileTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

function safeError(error) {
  if (!error) return { message: 'Unknown error' };
  return {
    at: new Date().toISOString(),
    provider: error.provider || null,
    status: error.status || null,
    code: error.code || null,
    message: error.message || String(error)
  };
}

class SessionJournal {
  constructor(outputDirectory) {
    if (!outputDirectory) throw new Error('outputDirectory is required.');
    this.outputDirectory = path.resolve(outputDirectory);
    this.sessionsDirectory = path.join(this.outputDirectory, 'Sessions');
    this.errorLogPath = path.join(this.outputDirectory, 'cue-errors.log');
    this.filePath = null;
    this.data = null;
    this.writeChain = Promise.resolve();
  }

  async start(startedAt = new Date()) {
    await fs.mkdir(this.sessionsDirectory, { recursive: true });
    const base = `${fileTimestamp(startedAt)} — session`;
    let candidate = path.join(this.sessionsDirectory, `${base}.json`);
    let suffix = 2;
    while (true) {
      try {
        await fs.access(candidate);
        candidate = path.join(this.sessionsDirectory, `${base} (${suffix++}).json`);
      } catch (error) {
        if (error.code === 'ENOENT') break;
        throw error;
      }
    }
    this.filePath = candidate;
    this.data = {
      version: 1,
      status: 'recording',
      startedAt: startedAt.toISOString(),
      updatedAt: startedAt.toISOString(),
      transcript: [],
      errors: [],
      recapFile: null
    };
    await this.persist();
    return this.filePath;
  }

  attach(filePath, data) {
    this.filePath = path.resolve(filePath);
    this.data = data;
  }

  async appendTurn(turn) {
    if (!this.data || !this.filePath) throw new Error('No active session journal.');
    this.data.transcript.push({ channel: turn.channel, speaker: turn.speaker || null, text: turn.text, ts: turn.ts });
    this.data.updatedAt = new Date().toISOString();
    await this.persist();
  }

  async appendError(error, area = 'stt') {
    const entry = { ...safeError(error), area };
    await fs.mkdir(this.outputDirectory, { recursive: true });
    await fs.appendFile(this.errorLogPath, `${JSON.stringify(entry)}\n`, 'utf8');
    if (this.data && this.filePath) {
      this.data.errors.push(entry);
      this.data.updatedAt = entry.at;
      await this.persist();
    }
  }

  async mark(status, patch = {}) {
    if (!this.data || !this.filePath) return;
    this.data = { ...this.data, ...patch, status, updatedAt: new Date().toISOString() };
    await this.persist();
  }

  async persist() {
    if (!this.data || !this.filePath) return;
    const snapshot = JSON.stringify(this.data, null, 2) + '\n';
    this.writeChain = this.writeChain.then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(this.filePath, snapshot, 'utf8');
    });
    await this.writeChain;
  }

  async recoverLatest() {
    await fs.mkdir(this.sessionsDirectory, { recursive: true });
    const names = (await fs.readdir(this.sessionsDirectory)).filter((name) => name.endsWith('.json')).sort().reverse();
    for (const name of names) {
      const filePath = path.join(this.sessionsDirectory, name);
      try {
        const data = JSON.parse(await fs.readFile(filePath, 'utf8'));
        if ((data.status === 'recording' || data.status === 'finalizing' || data.status === 'failed') && Array.isArray(data.transcript)) {
          this.attach(filePath, data);
          return { filePath, data };
        }
      } catch (error) {
        await this.appendError(error, 'journal-recovery');
      }
    }
    return null;
  }

  async listIncomplete() {
    await fs.mkdir(this.sessionsDirectory, { recursive: true });
    const names = (await fs.readdir(this.sessionsDirectory)).filter((name) => name.endsWith('.json')).sort().reverse();
    const sessions = [];
    for (const name of names) {
      try {
        const filePath = path.join(this.sessionsDirectory, name);
        const data = JSON.parse(await fs.readFile(filePath, 'utf8'));
        if (!['recording', 'finalizing', 'failed'].includes(data.status)) continue;
        sessions.push({
          filePath,
          status: data.status,
          startedAt: data.startedAt,
          updatedAt: data.updatedAt,
          turnCount: Array.isArray(data.transcript) ? data.transcript.length : 0,
          errorCount: Array.isArray(data.errors) ? data.errors.length : 0
        });
      } catch (error) {
        await this.appendError(error, 'journal-list');
      }
    }
    return sessions;
  }

  async load(filePath) {
    const resolved = path.resolve(filePath);
    const relative = path.relative(this.sessionsDirectory, resolved);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !resolved.endsWith('.json')) {
      throw new Error('Session path is outside the Cue sessions directory.');
    }
    const data = JSON.parse(await fs.readFile(resolved, 'utf8'));
    if (!Array.isArray(data.transcript)) throw new Error('Session transcript is invalid.');
    this.attach(resolved, data);
    return { filePath: resolved, data };
  }
}

module.exports = { SessionJournal };
