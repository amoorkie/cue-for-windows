const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

function scriptPath(name) {
  // Python cannot read Electron's virtual ASAR filesystem.
  return path.join(__dirname, 'local-stt', name).replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
}

class LocalSTT {
  constructor({ root, spawnProcess = spawn, timeoutMs = 60000, startupTimeoutMs = 120000 } = {}) {
    this.root = root;
    this.spawnProcess = spawnProcess;
    this.timeoutMs = timeoutMs;
    this.startupTimeoutMs = startupTimeoutMs;
    this.child = null;
    this.starting = null;
    this.pending = new Map();
    this.nextId = 0;
  }

  options(config = {}) {
    return {
      pythonPath: config.pythonPath || path.join(this.root, 'venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'),
      modelPath: config.modelPath || path.join(this.root, 'model')
    };
  }

  async prepare(config = {}) {
    const options = this.options(config);
    const key = JSON.stringify(options);
    if (this.child && this.key === key) return this.starting;
    this.stop();
    this.key = key;
    this.starting = new Promise((resolve, reject) => {
      const child = this.spawnProcess(options.pythonPath, ['-u', scriptPath('worker.py'), options.modelPath], {
        windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONUTF8: '1', HF_HUB_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1' }
      });
      this.child = child;
      let stderr = '';
      let ready = false;
      const timer = setTimeout(() => fail(new Error('GigaAM не загрузилась за 120 секунд. Проверьте модель и свободную память.')), this.startupTimeoutMs);
      const fail = (error) => {
        clearTimeout(timer);
        reject(error);
        if (this.child === child) this.stop(error);
      };
      const lines = readline.createInterface({ input: child.stdout });
      child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString('utf8')).slice(-2500); });
      child.stdin.on('error', (error) => fail(error));
      child.on('error', (error) => fail(new Error('Не удалось запустить GigaAM. Установите её в настройках. ' + error.message)));
      child.on('exit', (code) => {
        lines.close();
        fail(new Error('Процесс GigaAM завершился (' + code + '). ' + stderr));
      });
      lines.on('line', (line) => {
        let message;
        try { message = JSON.parse(line); } catch { return fail(new Error('Некорректный ответ локальной GigaAM.')); }
        if (message.fatal) return fail(new Error(message.fatal));
        if (message.ready) {
          ready = true;
          clearTimeout(timer);
          resolve({ ...options, model: message.model, device: message.device });
          return;
        }
        if (!ready) return;
        const job = this.pending.get(message.id);
        if (!job) return;
        clearTimeout(job.timer);
        this.pending.delete(message.id);
        if (message.error) job.reject(new Error(message.error));
        else job.resolve({ text: String(message.text || ''), provider: 'local-gigaam', elapsedMs: message.elapsedMs });
      });
    });
    return this.starting;
  }

  async transcribe(pcm, config) {
    await this.prepare(config);
    if (!Buffer.isBuffer(pcm) || pcm.length % 2 || pcm.length > 640000) throw new Error('Некорректный PCM-фрагмент.');
    if (pcm.length < 3200) return { text: '', provider: 'local-gigaam' };
    if (this.pending.size >= 4) throw new Error('GigaAM не успевает обрабатывать звук.');
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => this.stop(new Error('Превышено время распознавания GigaAM. Повторите проверку модели.')), this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, pcm: pcm.toString('base64') }) + '\n');
    });
  }

  stop(error = new Error('Локальная расшифровка остановлена.')) {
    const child = this.child;
    this.child = null;
    this.starting = null;
    for (const job of this.pending.values()) { clearTimeout(job.timer); job.reject(error); }
    this.pending.clear();
    if (child) child.kill();
  }
}

function runCommand(command, args, onLine, timeoutMs = 15 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, shell: false, env: { ...process.env, PYTHONUTF8: '1' } });
    let detail = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Установка заняла слишком много времени. Повторите попытку.')); }, timeoutMs);
    const lines = readline.createInterface({ input: child.stdout });
    lines.on('line', (line) => { if (onLine) onLine(line); });
    child.stderr.on('data', (data) => { detail = (detail + data.toString('utf8')).slice(-2500); });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('exit', (code) => {
      clearTimeout(timer); lines.close();
      if (code === 0) resolve();
      else reject(new Error('Не удалось установить GigaAM. ' + detail));
    });
  });
}

async function setupLocalSTT(root, onProgress = () => {}, bootstrapPython = process.platform === 'win32' ? 'python' : 'python3') {
  fs.mkdirSync(root, { recursive: true });
  const pythonPath = path.join(root, 'venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const modelPath = path.join(root, 'model');
  if (!fs.existsSync(pythonPath)) {
    onProgress('Создаю окружение Python для GigaAM…');
    try {
      await runCommand(bootstrapPython, ['-c', 'import sys; assert sys.version_info >= (3, 12)'], null, 15000);
      await runCommand(bootstrapPython, ['-m', 'venv', path.join(root, 'venv')]);
    } catch (error) { throw new Error('Для установки GigaAM нужен Python 3.12+ в PATH. ' + error.message); }
  }
  onProgress('Устанавливаю движок распознавания…');
  await runCommand(pythonPath, ['-m', 'pip', 'install', '--disable-pip-version-check', 'onnx-asr[cpu,hub]==0.12.0', 'onnxruntime==1.29.0', 'numpy==2.5.3', 'huggingface-hub==1.30.0']);
  onProgress('Скачиваю GigaAM v3 (около 900 МБ)…');
  await runCommand(pythonPath, ['-u', scriptPath('download.py'), modelPath], (line) => {
    try { const value = JSON.parse(line); if (value.message) onProgress(value.message); } catch { /* library progress */ }
  });
  return { pythonPath, modelPath };
}

module.exports = { LocalSTT, setupLocalSTT };
