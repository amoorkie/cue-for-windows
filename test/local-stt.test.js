const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { LocalSTT } = require('../src/local-stt');
const { createSTT } = require('../src/stt');
const { SpeechBuffer } = require('../src/speech-buffer');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

test('local settings survive restart and preserve a chat-only provider and key', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cue-store-local-'));
  const file = path.join(directory, 'cue-data.json');
  fs.writeFileSync(file, JSON.stringify({ provider: 'anthropic', apiKeys: { anthropic: 'chat-key' }, stt: { mode: 'local', local: { modelPath: '/model', pythonPath: '/python' } } }));
  const original = Module._load;
  const modulePath = require.resolve('../src/store');
  Module._load = function(request, ...args) { return request === 'electron' ? { app: { getPath: () => directory } } : original.call(this, request, ...args); };
  try {
    delete require.cache[modulePath];
    let store = require('../src/store');
    assert.equal(store.getSettings().provider, 'anthropic');
    store.setSettings({ appearance: { language: 'en' } });
    delete require.cache[modulePath];
    store = require('../src/store');
    const saved = store.getSettings();
    assert.equal(saved.stt.mode, 'local');
    assert.equal(saved.stt.local.modelPath, '/model');
    assert.equal(saved.apiKeys.anthropic, 'chat-key');
    assert.ok(Object.values(saved.stt.routes).every((route) => !route.enabled));
    store.setSettings({ stt: { mode: 'api', provider: 'openai' }, provider: 'openai', apiKeys: { openai: 'new-chat-key' } });
    delete require.cache[modulePath];
    const restored = require('../src/store').getSettings();
    assert.equal(restored.stt.mode, 'api');
    assert.equal(restored.stt.routes.openai.enabled, true);
    assert.equal(restored.stt.local.modelPath, '/model');
  } finally {
    Module._load = original;
    delete require.cache[modulePath];
    fs.unlinkSync(file);
    fs.rmdirSync(directory);
  }
});

test('local mode exclusively uses local PCM even when cloud routes are enabled', async () => {
  const pcm = Buffer.alloc(16000, 2);
  const route = createSTT({ provider: 'openai', apiKeys: { openai: 'must-not-leave' }, stt: {
    mode: 'local', local: { modelPath: '/model' }, routes: { openai: { enabled: true, model: 'whisper-1' } }
  } }, { localSTT: { transcribe: async (input, config) => {
    assert.equal(input, pcm);
    assert.equal(config.modelPath, '/model');
    return { text: 'Локальная речь', provider: 'local-gigaam' };
  } } });
  assert.deepEqual(route.providers, ['local-gigaam']);
  assert.equal((await route.transcribe(pcm)).text, 'Локальная речь');
});

test('local failures never fall back to an API route', async () => {
  const route = createSTT({ stt: { mode: 'local', routes: { openai: { enabled: true, model: 'whisper-1' } } } }, {
    localSTT: { transcribe: async () => { throw new Error('damaged model'); } }
  });
  assert.deepEqual(await route.transcribe(Buffer.alloc(4000)), { text: '', error: {
    provider: 'local-gigaam', code: 'local_stt_error', message: 'damaged model'
  } });
});

function transport(code, options = {}) {
  let launches = 0;
  const worker = new LocalSTT({ root: '/test', ...options, spawnProcess: (_command, _args, launchOptions) => {
    assert.equal(launchOptions.shell, false);
    assert.equal(launchOptions.windowsHide, true);
    assert.equal(launchOptions.env.HF_HUB_OFFLINE, '1');
    launches++;
    return spawn(process.execPath, ['-e', code], { windowsHide: true });
  } });
  return { worker, launches: () => launches };
}

test('worker loads once and matches concurrent channel responses by id', async () => {
  const { worker, launches } = transport(`console.log(JSON.stringify({ready:true}));
    require('readline').createInterface({input:process.stdin}).on('line',line=>{
      const r=JSON.parse(line); setTimeout(()=>console.log(JSON.stringify({id:r.id,text:String(Buffer.from(r.pcm,'base64').length)})),r.id===1?30:0);
    });`);
  try {
    const results = await Promise.all([worker.transcribe(Buffer.alloc(4000)), worker.transcribe(Buffer.alloc(8000))]);
    assert.deepEqual(results.map((r) => r.text), ['4000', '8000']);
    assert.equal(launches(), 1);
    assert.equal(worker.pending.size, 0);
  } finally { worker.stop(); }
});

test('stalled worker times out, clears every request and can restart', async () => {
  const { worker, launches } = transport(`console.log(JSON.stringify({ready:true})); process.stdin.resume();`, { timeoutMs: 60 });
  try {
    const results = await Promise.allSettled([worker.transcribe(Buffer.alloc(4000)), worker.transcribe(Buffer.alloc(8000))]);
    assert.ok(results.every((result) => result.status === 'rejected'));
    assert.equal(worker.pending.size, 0);
    await worker.prepare();
    assert.equal(launches(), 2);
  } finally { worker.stop(); }
});

function speech(seconds) { const pcm = Buffer.alloc(seconds * 32000); for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(1000, i); return pcm; }

test('live buffer keeps a phrase until a pause, then emits it intact', () => {
  const queue = new SpeechBuffer();
  queue.push(speech(1), 1000);
  assert.equal(queue.take({ live: true }), null);
  queue.push(Buffer.alloc(12800));
  const result = queue.take({ live: true });
  assert.equal(result.ts, 1000);
  assert.equal(result.pcm.length, 44800);
  assert.equal(queue.bytes, 0);
});

test('continuous speech emits before 5 seconds and final short tail is retained', () => {
  const queue = new SpeechBuffer();
  queue.push(speech(4.5));
  assert.equal(queue.take({ live: true }).pcm.length, 144000);
  queue.push(speech(0.2));
  assert.equal(queue.take({ live: true }), null);
  assert.equal(queue.take({ force: true }).pcm.length, 6400);
});

test('stop drains long backlog in bounded chunks without losing samples', () => {
  const queue = new SpeechBuffer();
  const pcm = speech(22);
  queue.push(pcm, 1000);
  const chunks = [];
  while (queue.bytes) chunks.push(queue.take({ force: true }));
  assert.deepEqual(chunks.map((chunk) => chunk.pcm.length), [256000, 256000, 192000]);
  assert.deepEqual(chunks.map((chunk) => chunk.ts), [1000, 9000, 17000]);
  assert.deepEqual(Buffer.concat(chunks.map((chunk) => chunk.pcm)), pcm);
});

test('backlog limit fails explicitly and preserves audio already accepted', () => {
  const queue = new SpeechBuffer({ maxSeconds: 1 });
  queue.push(speech(1));
  assert.throws(() => queue.push(speech(0.1)), /очередь/);
  assert.equal(queue.take({ force: true }).pcm.length, 32000);
});
