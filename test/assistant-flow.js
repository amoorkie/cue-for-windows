// Real main process, IPC and renderer; isolated files, deterministic STT/API fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { app, BrowserWindow, shell, Notification, globalShortcut } = require('electron');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cue-actions-'));
app.setPath('userData', root);
process.env.CUE_DOCUMENTS_DIR = path.join(root, 'documents');
shell.openPath = async () => '';
Notification.isSupported = () => false;
globalShortcut.register = () => true;
let speech = '';
let screenshots = 0;
function mock(name, exports) {
  const id = require.resolve(name);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}
mock('../src/stt', { createSTT: () => ({ available: true, transcribe: async () => {
  await new Promise((resolve) => setTimeout(resolve, 100));
  const text = speech; speech = ''; return { text, provider: 'fixture' };
} }) });
mock('../src/screen', { captureScreenshot: async () => { screenshots++; return null; } });
const requests = [];
let failRecap = false;
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (data) => { body += data; });
  req.on('end', () => {
    const data = JSON.parse(body); requests.push(data);
    const system = data.messages[0].content;
    if (failRecap && system.includes('Summarize the conversation')) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Service temporarily unavailable' } })); return;
    }
    const content = system.includes('This is automatic assistance') ? 'NO_ACTION' :
      system.includes('Summarize the conversation') ? '# Блокировки\n\nРешение ещё не принято.' : 'Оптимистичная блокировка проверяет версию при сохранении.';
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    setTimeout(() => res.end('data: ' + JSON.stringify({ choices: [{ delta: { content }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n'), 150);
  });
});
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, label, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await check()) return; await wait(30); }
  throw new Error('Timed out: ' + label);
}
server.listen(0, '127.0.0.1', async () => {
  const baseURL = `http://127.0.0.1:${server.address().port}/v1`;
  fs.writeFileSync(path.join(root, 'cue-data.json'), JSON.stringify({ onboarded: true,
    provider: 'openai', apiKeys: { openai: 'fixture' }, models: { openai: { fast: 'fixture', smart: 'fixture' } },
    baseUrls: { openai: baseURL }, trustedBaseUrls: { openai: baseURL }, stt: { mode: 'api' }
  }));
  require('../main');
  try {
    await app.whenReady();
    let win;
    await until(() => { win = BrowserWindow.getAllWindows().find(w => w.cueSurface === 'panel'); return win && !win.webContents.isLoading(); }, 'window');
    const js = (code) => win.webContents.executeJavaScript(code);
    await until(() => js('document.documentElement.dataset.ready === "true"'), 'renderer ready');
    await until(() => js(`document.querySelector('[data-mode="say"]').textContent.includes('Что ответить?')`), 'localized labels');
    await wait(350); // Allow the native compositor to present fonts and the first animation frame.
    assert.equal(await js(`Array.from(document.querySelectorAll('#action-row .act')).every(el=>el.scrollWidth<=el.clientWidth)`), true, 'action labels fit');
    fs.mkdirSync(path.resolve('.local-stt/qa'), { recursive: true });
    fs.writeFileSync(path.resolve('.local-stt/qa/actions.png'), (await win.webContents.capturePage()).toPNG());
    await js(`window.events=[]; for(const type of ['llm:done','llm:error','transcript:updated','capture:state','recovery:available']) cue.on(type,data=>events.push({type,...data}));
      navigator.mediaDevices.getUserMedia=async()=>{throw new Error('fixture');};
      navigator.mediaDevices.getDisplayMedia=async()=>{throw new Error('fixture');}; true;`);
    const completed = () => js(`events.filter(e=>e.type==='llm:done'||e.type==='llm:error').length`);
    const action = async (mode, text = '') => {
      const before = await completed();
      await js(`document.getElementById('input').value=${JSON.stringify(text)}; document.querySelector('[data-mode="${mode}"]').click();`);
      await until(async () => (await completed()) > before, mode);
    };
    const pcm = Buffer.alloc(16000); for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(2000, i);
    const feed = async (text) => {
      speech = text;
      await js(`cue.micPcm(Uint8Array.from(atob('${pcm.toString('base64')}'), c=>c.charCodeAt(0)).buffer)`);
    };
    const journal = () => {
      const dir = path.join(root, 'documents', 'Sessions');
      const file = fs.readdirSync(dir).sort().at(-1);
      return { file: path.join(dir, file), data: JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) };
    };
    await js('cue.captureToggle()');
    await js('cue.workspaceToggle()');
    assert.equal(win.isVisible(), false);
    await feed('расскажи что такое оптимистичные и пессимистичные блокировки');
    await action('assist');
    assert.match(requests.at(-1).messages.at(-1).content, /оптимистичные/,'manual help flushes pending mic speech');
    assert.equal(journal().data.status, 'recording', 'hidden panel keeps recording');
    await js('cue.workspaceToggle()');
    assert.equal(win.isVisible(), true);
    assert.match(requests.at(-1).messages[0].content, /explicit request for help/);
    await action('say', 'Объясни разницу с примером');
    assert.match(requests.at(-1).messages.at(-1).content, /Explicit typed request.*Объясни/);
    assert.ok(requests.at(-1).messages.some((m) => m.role === 'assistant'), 'typed refinement carries chat history');
    await action('followup', 'Про конфликты записей');
    assert.match(requests.at(-1).messages.at(-1).content, /Про конфликты/);
    await action('recap');
    assert.equal(journal().data.status, 'recording');
    assert.equal(journal().data.recapFile, null);
    assert.equal(screenshots, 0, 'summary does not send an unrelated screenshot');
    assert.equal(requests.at(-1).messages.length, 2, 'summary excludes private assistant suggestions');
    speech = 'Как выбрать подходящий способ блокировки?';
    await js(`cue.systemPcm(Uint8Array.from(atob('${pcm.toString('base64')}'), c=>c.charCodeAt(0)).buffer)`);
    await until(() => journal().data.transcript.length === 2, 'remote question');
    const beforeAuto = await completed();
    await js(`document.getElementById('auto-assist-btn').click()`);
    await until(async () => (await completed()) > beforeAuto, 'automatic help');
    assert.equal(await js(`document.getElementById('messages').textContent.includes('NO_ACTION')`), false);
    await js(`document.getElementById('auto-assist-btn').click()`);
    failRecap = true;
    const beforeStop = await completed();
    await feed('Я подготовлю оценку рисков к четвергу');
    await js('cue.captureToggle()');
    await until(async () => (await completed()) > beforeStop, 'failed final recap');
    await until(() => journal().data.status === 'failed', 'failed journal');
    assert.equal(journal().data.transcript.length, 3, 'stop drains tail');
    assert.match(fs.readFileSync(journal().data.rawFile, 'utf8'), /к четвергу/);
    await until(() => js(`document.querySelectorAll('.recovery-item').length === 1`), 'immediate retry card');
    failRecap = false;
    await js(`cue.sessionSummary(${JSON.stringify(journal().file)})`);
    assert.equal(journal().data.status, 'completed');
    assert.ok(fs.existsSync(journal().data.recapFile));
    const oldRaw = journal().data.rawFile;
    await js(`cue.sessionContinue(${JSON.stringify(journal().file)})`);
    await feed('Следующий созвон назначен на понедельник');
    const rawRequests = requests.length;
    await js(`document.getElementById('finish-raw-btn').click()`);
    await until(() => journal().data.status === 'completed' && journal().data.rawTurnCount === 4, 'RAW after resume');
    assert.notEqual(journal().data.rawFile, oldRaw);
    assert.match(fs.readFileSync(journal().data.rawFile, 'utf8'), /понедельник/);
    assert.equal(requests.length, rawRequests, 'RAW never calls AI');
    assert.equal(await js(`document.getElementById('send-btn').classList.contains('busy')`), false, 'RAW does not lock composer');
    await action('say', 'Объясни короче');
    assert.match(requests.at(-1).messages.at(-1).content, /Объясни короче/);
    console.log(JSON.stringify({ pass: true, checks: ['pending mic help', 'typed mode request', 'chat refinement', 'followup focus', 'live recap status', 'no recap screenshot', 'no private chat in summary', 'silent auto', '503 and immediate retry', 'stop tail', 'RAW after resume', 'RAW no AI or stuck composer'], root }));
    server.close(); app.emit('will-quit'); app.exit(0);
  } catch (error) { console.error(error.stack); server.close(); app.emit('will-quit'); app.exit(1); }
});
setTimeout(() => { console.error('Assistant flow timeout'); app.exit(1); }, 60000).unref();
