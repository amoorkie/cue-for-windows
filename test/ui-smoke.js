// Настоящие окна с синтетическими событиями речи/ИИ; микрофон и внешние API не используются.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, clipboard, screen, globalShortcut } = require('electron');
// В CI не полагаемся на наличие аппаратного GPU у виртуальной машины.
if (process.env.CI) app.disableHardwareAcceleration();
globalShortcut.register = () => true; // Do not claim the running app's shortcuts.
const { wait, until, surface, js, screenshot } = require('./electron-helpers');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cue-ui-'));
app.setPath('userData', root);
process.env.CUE_DOCUMENTS_DIR = path.join(root, 'documents');
process.env.CUE_NO_PROTECT = '1';
fs.mkdirSync(process.env.CUE_DOCUMENTS_DIR);
fs.writeFileSync(path.join(process.env.CUE_DOCUMENTS_DIR, 'meeting.md'), '# Проверка каталога\n\nСогласовали демонстрацию в пятницу.');
fs.writeFileSync(path.join(root, 'cue-data.json'), JSON.stringify({ onboarded: true,
  appearance: { panelWidth: 760, panelHeight: 884, backgroundColor: '#08090c', accentColor: '#7c8cff', backgroundOpacity: .9, cornerRadius: 10, textScale: .88 } }));
require('../main');
app.whenReady().then(async () => {
  const images = [];
  try {
    const panel = await surface('panel'), toolbar = await surface('toolbar');
    assert.notEqual(panel.id, toolbar.id);
    assert.equal(await js(panel, `document.getElementById('messages').childElementCount`), 0);
    assert.equal(await js(panel, `getComputedStyle(document.getElementById('toolbar')).display`), 'none');
    assert.equal(await js(toolbar, `getComputedStyle(document.getElementById('panel-wrap')).display`), 'none');
    assert.equal(await js(panel, `document.getElementById('screen-select').options.length`), screen.getAllDisplays().length);
    const chosen = String(screen.getAllDisplays().at(-1).id);
    await js(panel, `cue.displaySelect(${JSON.stringify(chosen)})`);
    panel.setPosition(300, 100);
    assert.equal((await js(panel, 'cue.displaysGet()')).selectedId, chosen, 'moving chat keeps selected screen');
    await assert.rejects(js(panel, `cue.displaySelect('disconnected-fixture')`));

    const turns = [
      { id: 't1', channel: 'them', text: 'Как организуем работу над новой версией?', ts: 1000, endTs: 2500 },
      { id: 't2', channel: 'them', text: 'Нужно проверить интерфейс и перенос окон между мониторами.', ts: 3000, endTs: 5000 },
      { id: 't3', channel: 'you', text: 'Сначала проверим основные сценарии, затем подготовим демонстрацию.', ts: 7000, endTs: 10000 }
    ];
    panel.webContents.send('session:loaded', { transcript: turns });
    await until(() => js(panel, `document.getElementById('transcript-preview-text').textContent.includes('Сначала проверим')`), 'latest speech preview');
    assert.equal(await js(panel, `document.querySelectorAll('.transcript-row').length`), 0, 'main panel has no hidden full transcript');
    await js(panel, `document.getElementById('input').value='Мой черновик'; document.getElementById('input').dispatchEvent(new Event('input',{bubbles:true})); document.getElementById('transcript-preview').click()`);
    const transcriptWindow = await surface('transcript');
    transcriptWindow.webContents.send('session:loaded', { transcript: turns });
    const publish = (channel, payload) => { panel.webContents.send(channel, payload); transcriptWindow.webContents.send(channel, payload); };
    await until(() => js(transcriptWindow, `document.querySelectorAll('.transcript-row').length === 2`), 'grouped transcript in its own window');
    assert.notEqual(panel.id, transcriptWindow.id);
    assert.ok(panel.isVisible());
    assert.equal(await js(panel, `document.getElementById('answer-view').hidden`), false);
    assert.equal(await js(panel, `document.getElementById('input').value`), 'Мой черновик');
    assert.equal(await js(transcriptWindow, `getComputedStyle(document.getElementById('panel-wrap')).display`), 'none');
    panel.webContents.send('llm:start', { requestId: 'r1', userBubble: 'Предложи порядок проверки', requestedModel: 'model-alias', provider: 'fixture', mode: 'assist', append: true });
    panel.webContents.send('llm:metadata', { requestId: 'r1', reportedModel: 'gpt-5.6-sol' });
    panel.webContents.send('llm:token', { text: '**Начните с переноса окон.** Проверьте каждый монитор отдельно и перенос всей группы.\n\nЗатем проверьте расшифровку:\n- раскрытие до поля ввода;\n- сохранение позиции при прокрутке;\n- подписи говорящих при эхе.' });
    panel.webContents.send('llm:done', {});
    await until(() => js(panel, `document.querySelector('.ai-message')?.dataset.status === 'done'`), 'answer');
    assert.equal(await js(panel, `document.querySelector('.answer-model').textContent`), 'gpt-5.6-sol');
    assert.equal(await js(panel, `document.querySelector('.mode-badge').textContent`), 'Помощь');
    assert.equal(await js(panel, `getComputedStyle(document.querySelector('.mode-badge')).textTransform`), 'none');
    assert.equal(await js(panel, `getComputedStyle(document.querySelector('.user-bubble')).boxShadow`), 'none');
    assert.equal(await js(panel, `getComputedStyle(document.querySelector('.user-bubble')).userSelect`), 'text');
    assert.ok(await js(panel, `parseFloat(getComputedStyle(document.querySelector('.user-bubble')).fontSize) < parseFloat(getComputedStyle(document.querySelector('.ai-text')).fontSize)`));
    images.push(await screenshot(panel, '01-latest-phrase'));
    images.push(await screenshot(transcriptWindow, '02-transcript-window'));
    const diagnosticsFit = () => js(panel, `(() => {
      const header=document.getElementById('panel-topbar').getBoundingClientRect();
      return [...document.querySelectorAll('#capture-diagnostics .diag-pill, #screen-select')].every(el=>{
        const r=el.getBoundingClientRect();
        return r.width>0 && r.height>0 && r.left>=header.left && r.right<=header.right && r.top>=header.top && r.bottom<=header.bottom;
      });
    })()`);
    assert.equal(await diagnosticsFit(), true, 'diagnostics and screen choice fit in the header');
    const fullBounds = panel.getBounds();
    panel.setBounds({ ...fullBounds, width: 568, height: 650 });
    await until(() => js(panel, 'window.innerWidth === 568'), 'minimum width applied to the renderer');
    assert.equal(await diagnosticsFit(), true, 'diagnostics stay visible at minimum panel width');
    images.push(await screenshot(panel, '01-narrow'));
    panel.setBounds(fullBounds); await wait(100);
    assert.equal(await js(panel, `document.getElementById('input').value`), 'Мой черновик');
    const longTurns = Array.from({ length: 80 }, (_, i) => ({ id: 'long-' + i, channel: i % 2 ? 'you' : 'them', text: 'Обсуждаем следующий этап проекта и фиксируем договорённости. '.repeat(3), ts: 20000 + i * 5000, endTs: 21000 + i * 5000 }));
    publish('transcript:updated', { upserts: longTurns, removed: [] });
    await wait(100);
    await js(transcriptWindow, `document.getElementById('live-transcript').scrollTop=0`);
    await wait(100);
    publish('transcript:updated', { upserts: [{ id: 'latest', channel: 'them', text: 'Последняя реплика без потери прокрутки.', ts: 500000 }], removed: [] });
    await wait(100);
    assert.equal(await js(transcriptWindow, `document.getElementById('live-transcript').scrollTop`), 0);
    assert.match(await js(panel, `document.getElementById('transcript-preview-text').textContent`), /Последняя реплика/);
    images.push(await screenshot(transcriptWindow, '03-transcript-reading'));
    const previousClipboard = clipboard.readText();
    try {
      await js(panel, `document.getElementById('copy-btn').click()`);
      await until(() => clipboard.readText().includes('Предложи порядок проверки'), 'copy speech with chat');
      assert.match(clipboard.readText(), /Последняя реплика/);
      transcriptWindow.focus();
      await wait(100);
      await js(transcriptWindow, `document.getElementById('transcript-copy').click()`);
      await until(() => clipboard.readText().includes('Последняя реплика') && !clipboard.readText().includes('Предложи порядок проверки'), 'copy only speech');
    } finally { clipboard.writeText(previousClipboard); }
    const chatCards = await js(panel, `document.querySelectorAll('.ai-message').length`);
    panel.webContents.send('llm:start', { requestId: 'auto', mode: 'auto', requestedModel: 'fixture', append: true });
    panel.webContents.send('llm:done', { suppress: true });
    await wait(100);
    assert.equal(await js(panel, `document.querySelectorAll('.ai-message').length`), chatCards, 'suppressed auto removes its card');
    panel.webContents.send('llm:start', { requestId: 'auto-visible', mode: 'auto', requestedModel: 'fixture', append: true });
    panel.webContents.send('llm:token', { text: 'Проверьте микрофон.' });
    panel.webContents.send('llm:done', {});
    await wait(80);
    assert.ok(transcriptWindow.isVisible());
    assert.equal(await js(transcriptWindow, `document.getElementById('live-transcript').scrollTop`), 0, 'AI response preserves reading');
    await js(transcriptWindow, `document.getElementById('live-transcript').scrollTop=180`);
    await wait(80);
    await js(transcriptWindow, `document.getElementById('transcript-close').click()`);
    await until(() => !transcriptWindow.isVisible(), 'transcript hidden');
    publish('transcript:updated', { upserts: [{ id: 'closed-new', channel: 'you', text: 'Новая реплика при закрытом окне.', ts: 510000 }], removed: [] });
    await wait(80);
    await js(panel, `document.getElementById('transcript-preview').click()`);
    await wait(80);
    assert.equal(await js(transcriptWindow, `document.getElementById('live-transcript').scrollTop`), 180, 'reopening retains scroll');
    assert.match(await js(transcriptWindow, `document.getElementById('live-transcript').textContent`), /при закрытом окне/);
    publish('transcript:updated', { removed: ['closed-new'], upserts: [{ id: 'latest', channel: 'them', text: 'Исправленная последняя реплика.', ts: 500000 }] });
    await until(() => js(panel, `document.getElementById('transcript-preview-text').textContent.includes('Исправленная')`), 'corrected preview');
    panel.webContents.send('llm:start', { requestId: 'shortcut', mode: 'assist', requestedModel: 'fixture', append: true });
    panel.webContents.send('llm:done', { suppress: true });
    await wait(80);
    assert.ok(transcriptWindow.isVisible(), 'manual assistance keeps transcript open');
    await js(transcriptWindow, `document.getElementById('transcript-latest').click()`);
    await until(() => js(transcriptWindow, `document.getElementById('transcript-latest').classList.contains('hidden')`), 'follow latest speech');
    await js(transcriptWindow, 'cue.windowClose()');
    await until(() => !transcriptWindow.isVisible(), 'close before keyboard opening');
    await js(panel, `document.getElementById('transcript-preview').focus()`);
    panel.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' });
    panel.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
    await until(() => transcriptWindow.isVisible(), 'keyboard opens transcript');
    transcriptWindow.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    transcriptWindow.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await until(() => !transcriptWindow.isVisible(), 'Escape closes transcript');
    await js(panel, `document.getElementById('transcript-preview').click()`);
    // Анимация не подтверждает исправность устройств: ошибки звука проверяем отдельно.
    // Виртуальный runner может уменьшать движение по умолчанию; оба режима задаём явно.
    panel.webContents.debugger.attach('1.3');
    await panel.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await until(() => js(panel, `document.documentElement.dataset.animations === 'on'`), 'animation test precondition');
    await js(panel, `navigator.mediaDevices.getUserMedia=async()=>{throw new Error('fixture');}; navigator.mediaDevices.getDisplayMedia=async()=>{throw new Error('fixture');}; true`);
    publish('capture:state', { active: true, initial: true });
    await wait(120);
    publish('capture:health', { mic: 'ok', system: 'ok' });
    await until(() => js(panel, `getComputedStyle(document.querySelector('.transcript-wave i')).animationName === 'transcriptRecording'`), 'recording animation');
    images.push(await screenshot(panel, '04-recording-preview'));
    await js(panel, `cue.settingsSet({appearance:{animations:false}})`);
    await until(() => js(panel, `getComputedStyle(document.querySelector('.transcript-wave i')).animationName === 'none'`), 'disabled animation');
    await js(panel, `cue.settingsSet({appearance:{animations:true}})`);
    await panel.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await until(() => js(panel, `getComputedStyle(document.querySelector('.transcript-wave i')).animationName === 'none'`), 'reduced motion');
    await panel.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] });
    panel.webContents.debugger.detach();
    publish('capture:health', { mic: 'error', system: 'error' });
    await until(() => js(panel, `document.getElementById('transcript-preview-status').textContent === 'Проверьте звук'`), 'audio warning');
    assert.equal(await js(panel, `getComputedStyle(document.querySelector('.transcript-wave i')).animationName`), 'none');
    publish('capture:state', { active: false });
    await until(() => js(panel, `document.getElementById('transcript-preview-status').textContent === 'Запись остановлена'`), 'recording stopped');

    await js(panel, `cue.windowOpen('settings')`);
    const settings = await surface('settings');
    assert.ok(settings.isVisible());
    const providerChecks = await js(settings, `(async () => {
      const el = id => document.getElementById(id);
      el('provider-select').value='compatible'; el('provider-select').dispatchEvent(new Event('change',{bubbles:true}));
      el('base-url').value='http://localhost:11434/v1'; el('base-url').dispatchEvent(new Event('input',{bubbles:true}));
      el('model-fast').value='fixture-model'; el('stt-model').value='fixture-stt'; el('provider-api-key').value='fixture-key';
      el('s-close').click(); await new Promise(r=>setTimeout(r,150));
      const untrustedBlocked=!el('settings-scrim').classList.contains('hidden');
      el('endpoint-trust').checked=true; el('endpoint-trust').dispatchEvent(new Event('change',{bubbles:true}));
      el('appearance-text-scale').value='20'; el('appearance-text-scale').dispatchEvent(new Event('input',{bubbles:true}));
      el('s-close').click(); await new Promise(r=>setTimeout(r,150));
      const saved=await cue.settingsGet();
      return { untrustedBlocked, saved:saved.baseUrls.compatible, trusted:saved.trustedBaseUrls.compatible,
        model:saved.models.compatible.fast, sharedKey:saved.sttApiKeys.compatible===saved.apiKeys.compatible,
        tabs:document.querySelectorAll('[data-settings-tab]').length, closed:el('settings-scrim').classList.contains('hidden'),
        customControls:document.querySelectorAll('.custom-select').length>=3,
        themes:document.querySelectorAll('[data-preset]').length };
    })()`);
    assert.deepEqual(providerChecks, { untrustedBlocked: true, saved:'http://localhost:11434/v1', trusted:'http://localhost:11434/v1', model:'fixture-model', sharedKey:true, tabs:2, closed:true, customControls:true, themes:6 });
    await until(() => !settings.isVisible(), 'settings native close');
    await until(() => js(panel, `document.documentElement.style.getPropertyValue('--text-zoom') === '1.25'`), 'shared appearance');
    await js(panel, `cue.windowOpen('settings')`); await wait(150);
    await js(settings, `document.getElementById('endpoint-trust').checked=false; document.getElementById('endpoint-trust').dispatchEvent(new Event('change',{bubbles:true})); document.getElementById('s-close').click()`);
    await wait(150); assert.ok(settings.isVisible(), 'revoked trust keeps settings open');
    await js(settings, `document.getElementById('base-url').value='http://remote.invalid/v1'; document.getElementById('base-url').dispatchEvent(new Event('input',{bubbles:true})); document.getElementById('s-close').click()`);
    await wait(150);
    assert.equal((await js(panel, 'cue.settingsGet()')).baseUrls.compatible, 'http://localhost:11434/v1', 'invalid endpoint cannot replace saved route');
    images.push(await screenshot(settings, '04-settings-validation'));
    await js(panel, `cue.windowOpen('catalog')`);
    const catalog = await surface('catalog');
    assert.equal(await js(catalog, `document.querySelectorAll('.catalog-item').length`), 1);
    assert.equal(await js(catalog, `[...document.querySelectorAll('.catalog-action')].map(el=>el.textContent).join(' ')`), 'Открыть DOCX PDF');
    await js(panel, `cue.windowOpen('onboard')`);
    const onboard = await surface('onboard');
    assert.equal(await js(onboard, `document.getElementById('ob-title').textContent`), 'Добро пожаловать в Cue');
    await js(toolbar, 'cue.workspaceToggle()'); await wait(100);
    assert.ok(toolbar.isVisible());
    assert.ok([panel, transcriptWindow, settings, catalog, onboard].every(w=>!w.isVisible()));
    await js(toolbar, 'cue.workspaceToggle()'); await wait(100);
    assert.ok([panel, transcriptWindow, settings, catalog, onboard].every(w=>w.isVisible()));
    console.log(JSON.stringify({ pass:true, checks:['native surfaces','screen selection','grouped transcript','latest phrase and separate window','recording animation','reduced motion','audio warning','keyboard','draft','scroll retention','hidden text copy','model metadata','compact messages','silent auto','provider trust','shared appearance','catalog','onboarding','workspace visibility'], images }));
    app.emit('will-quit'); app.exit(0);
  } catch (error) { console.error(error.stack); app.emit('will-quit'); app.exit(1); }
});
setTimeout(()=>{ console.error('UI test timeout'); app.exit(1); }, 45000).unref();
