// Real Electron + real local GigaAM. Only the chat API and capture devices are fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { app, BrowserWindow, shell, Notification } = require('electron');
const { LocalSTT } = require('../src/local-stt');

const root = path.resolve(process.env.CUE_LOCAL_STT_ROOT || '.local-stt');
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cue-local-flow-'));
app.setPath('userData', stateDir);
process.env.CUE_DOCUMENTS_DIR = path.join(stateDir, 'documents');
shell.openPath = async () => '';
Notification.isSupported = () => false;
const screenModule = require.resolve('../src/screen');
require.cache[screenModule] = { id: screenModule, filename: screenModule, loaded: true, exports: { captureScreenshot: async () => null } };

const requests = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    const data = JSON.parse(body);
    requests.push({ url: req.url, ...data });
    const recap = /Summarize the conversation/.test(data.messages[0].content);
    const text = recap ? '# Сроки проекта\n\nПервый результат — в пятницу.' : 'Предлагаю показать первый результат в пятницу.';
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    setTimeout(() => {
      res.end('data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\ndata: [DONE]\n\n');
    }, 500);
  });
});

function pcmFromWave(file) {
  const wav = fs.readFileSync(file);
  for (let i = 12; i + 8 <= wav.length;) {
    const size = wav.readUInt32LE(i + 4);
    if (wav.toString('ascii', i, i + 4) === 'data') return wav.subarray(i + 8, i + 8 + size);
    i += 8 + size + size % 2;
  }
  throw new Error('WAV has no PCM data: ' + file);
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, label, timeout = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeout) { const result = await check(); if (result) return result; await wait(50); }
  throw new Error('Timed out: ' + label);
}

server.listen(0, '127.0.0.1', async () => {
  const endpoint = 'http://127.0.0.1:' + server.address().port + '/v1';
  const config = new LocalSTT({ root }).options();
  fs.writeFileSync(path.join(stateDir, 'cue-data.json'), JSON.stringify({
    onboarded: true, provider: 'openai', apiKeys: { openai: 'fixture-key' },
    baseUrls: { openai: endpoint }, trustedBaseUrls: { openai: endpoint },
    models: { openai: { fast: 'fixture-chat', smart: 'fixture-chat' } }, stt: { mode: 'local', local: config }
  }));
  require('../main');
  try {
    await app.whenReady();
    const win = await until(() => BrowserWindow.getAllWindows().find((w) => w.cueSurface === 'panel' && !w.webContents.isLoading()), 'window');
    const js = (code) => win.webContents.executeJavaScript(code);
    await until(() => js(`!!window.cue && document.querySelector('[data-mode="say"]').textContent.includes('Что ответить?')`), 'renderer ready');
    await js(`window.flowEvents=[];
      for(const type of ['transcript:updated','llm:done','llm:error','capture:state','status']) cue.on(type,data=>flowEvents.push({type,...data}));
      navigator.mediaDevices.getUserMedia=async()=>{throw new Error('Fixture: microphone disabled');};
      navigator.mediaDevices.getDisplayMedia=async()=>{throw new Error('Fixture: system capture disabled');}; true;`);

    // Configure local mode through the visible settings, including save without an STT API model.
    await js(`cue.windowOpen('settings')`);
    const settingsWindow = await require('./electron-helpers').surface('settings');
    const settingsJs = code => settingsWindow.webContents.executeJavaScript(code);
    const fields = await settingsJs(`({ mode:document.getElementById('stt-mode').value,
      visible:!document.getElementById('local-stt-fields').classList.contains('hidden'),
      cloudHidden:document.getElementById('stt-model-field').classList.contains('hidden') })`);
    assert.deepEqual(fields, { mode: 'local', visible: true, cloudHidden: true });
    await wait(300);
    fs.mkdirSync(path.join(root, 'qa'), { recursive: true });
    fs.writeFileSync(path.join(root, 'qa', 'settings.png'), (await settingsWindow.webContents.capturePage()).toPNG());
    await settingsJs(`document.getElementById('stt-model').value=''; document.getElementById('s-close').click();`);
    await until(() => settingsJs(`document.getElementById('settings-scrim').classList.contains('hidden')`), 'save settings');
    assert.equal((await js('cue.settingsGet()')).stt.mode, 'local');
    await js('cue.captureToggle()');
    const first = pcmFromWave(path.join(root, 'probe.wav'));
    const second = pcmFromWave(path.join(root, 'reply.wav'));
    await js(`cue.systemPcm(Uint8Array.from(atob(${JSON.stringify(first.toString('base64'))}),c=>c.charCodeAt(0)).buffer);`);
    await until(() => js(`flowEvents.some(e=>e.type==='transcript:updated' && e.upserts.some(t=>t.channel==='them'))`), 'live system transcript');
    assert.ok(await js(`getComputedStyle(document.getElementById('live-transcript')).display !== 'none'`));
    const blocked = await js(`cue.settingsSet({stt:{mode:'api'}}).then(()=>false,()=>true)`);
    assert.equal(blocked, true, 'cannot switch STT during capture');

    await js(`cue.ask({mode:'say',text:''})`);
    await until(() => js(`flowEvents.filter(e=>e.type==='llm:done').length===1`), 'suggestion');
    await js(`document.getElementById('input').value='Скажи короче.'; document.getElementById('send-btn').click();`);
    await until(() => js(`flowEvents.filter(e=>e.type==='llm:done').length===2`), 'follow-up');
    assert.equal(requests[1].messages.some((message) => message.role === 'assistant'), true, 'follow-up carries chat history');
    assert.match(JSON.stringify(requests[0]), /сроки проекта/);
    assert.ok(await js(`document.getElementById('messages').textContent.includes('Скажи короче.')`));
    assert.ok(await js(`document.querySelectorAll('#messages .ai-text').length === 2`));

    // Stop while an answer is in flight and final microphone audio is still pending.
    await js(`cue.micPcm(Uint8Array.from(atob(${JSON.stringify(second.toString('base64'))}),c=>c.charCodeAt(0)).buffer); cue.ask({mode:'ask',text:'Когда покажем результат?'});`);
    await until(() => requests.length === 3, 'answer in flight');
    await js('cue.captureToggle()');
    await until(() => js(`flowEvents.some(e=>e.type==='llm:done' && e.recapFile)`), 'saved final recap');
    const events = await js('flowEvents');
    assert.equal(events.filter((e) => e.type === 'llm:error').length, 0);
    const turns = events.filter((e) => e.type === 'transcript:updated').flatMap(e=>e.upserts);
    assert.deepEqual([...new Set(turns.map((turn) => turn.channel))].sort(), ['them', 'you']);
    assert.match(JSON.stringify(requests.at(-1)), /пятниц/);
    assert.match(requests.at(-1).messages.at(-1).content, /Full transcript/);
    assert.ok(requests.every((r) => r.url === '/v1/chat/completions' && !JSON.stringify(r).includes('input_audio')));
    const recap = events.find((e) => e.recapFile).recapFile;
    assert.match(fs.readFileSync(recap, 'utf8'), /пятниц/);
    const saved = JSON.parse(fs.readFileSync(path.join(stateDir, 'cue-data.json'), 'utf8'));
    assert.equal(saved.stt.mode, 'local');
    assert.ok(Object.values(saved.stt.routes).every((route) => !route.enabled));
    fs.writeFileSync(path.join(root, 'qa', 'live.png'), (await settingsWindow.webContents.capturePage()).toPNG());
    console.log(JSON.stringify({ pass: true, realGigaAM: true, audioChannels: turns.map((t) => t.channel), chatRequests: requests.length,
      historyPassed: true, stopDrainAndRecap: true, cloudAudioRequests: 0, stateDir }));
    // Avoid leaving Python running when this test uses app.exit rather than normal quit.
    app.emit('will-quit');
    server.close();
    app.exit(0);
  } catch (error) {
    console.error(error.stack);
    app.emit('will-quit');
    server.close();
    app.exit(1);
  }
});
setTimeout(() => { console.error('Local flow timed out'); app.emit('will-quit'); app.exit(1); }, 90000).unref();
