// Native panel integration with synthetic transcript/LLM events. No audio or API calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, clipboard, screen, globalShortcut } = require('electron');
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
    await until(() => js(panel, `document.querySelectorAll('.transcript-row').length === 2`), 'grouped transcript');
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
    images.push(await screenshot(panel, '01-compact'));
    await js(panel, `document.getElementById('input').value='Мой черновик'; document.getElementById('input').dispatchEvent(new Event('input',{bubbles:true})); document.getElementById('transcript-toggle').click()`);
    assert.equal(await js(panel, `document.getElementById('transcript-toggle').getAttribute('aria-expanded')`), 'false');
    images.push(await screenshot(panel, '02-collapsed'));
    await js(panel, `document.getElementById('transcript-expand').click()`);
    assert.equal(await js(panel, `document.getElementById('answer-view').hidden`), true);
    assert.equal(await js(panel, `document.getElementById('input').value`), 'Мой черновик');
    assert.ok(await js(panel, `document.getElementById('composer').getBoundingClientRect().bottom <= document.getElementById('panel').getBoundingClientRect().bottom`));
    const longTurns = Array.from({ length: 80 }, (_, i) => ({ id: 'long-' + i, channel: i % 2 ? 'you' : 'them', text: 'Обсуждаем следующий этап проекта и фиксируем договорённости. '.repeat(3), ts: 20000 + i * 5000, endTs: 21000 + i * 5000 }));
    panel.webContents.send('transcript:updated', { upserts: longTurns, removed: [] });
    await wait(100);
    await js(panel, `document.getElementById('live-transcript').scrollTop=0`);
    await wait(100);
    panel.webContents.send('transcript:updated', { upserts: [{ id: 'latest', channel: 'them', text: 'Последняя реплика без потери прокрутки.', ts: 500000 }], removed: [] });
    await wait(100);
    assert.equal(await js(panel, `document.getElementById('live-transcript').scrollTop`), 0);
    images.push(await screenshot(panel, '03-expanded'));
    const previousClipboard = clipboard.readText();
    try {
      await js(panel, `document.getElementById('copy-btn').click()`);
      await until(() => clipboard.readText().includes('Предложи порядок проверки'), 'copy hidden chat');
      assert.match(clipboard.readText(), /Последняя реплика/);
    } finally { clipboard.writeText(previousClipboard); }
    panel.webContents.send('llm:start', { requestId: 'auto', mode: 'auto', requestedModel: 'fixture', append: true });
    panel.webContents.send('llm:done', { suppress: true });
    await wait(100);
    assert.equal(await js(panel, `document.querySelectorAll('.ai-message').length`), 1, 'suppressed auto removes the entire card');
    assert.equal(await js(panel, `document.getElementById('chat-unread').classList.contains('hidden')`), true, 'suppressed auto has no unread badge');
    panel.webContents.send('llm:start', { requestId: 'auto-visible', mode: 'auto', requestedModel: 'fixture', append: true });
    panel.webContents.send('llm:token', { text: 'Проверьте микрофон.' });
    panel.webContents.send('llm:done', {});
    await wait(80);
    assert.equal(await js(panel, `document.getElementById('panel').dataset.transcriptState`), 'full', 'automatic answer preserves reading');
    assert.equal(await js(panel, `document.getElementById('chat-unread').classList.contains('hidden')`), false);
    await js(panel, `document.getElementById('live-transcript').scrollTop=180`);
    await wait(80);
    await js(panel, `document.getElementById('transcript-toggle').click()`);
    panel.webContents.send('transcript:updated', { upserts: [{ id: 'collapsed-new', channel: 'you', text: 'Новая реплика при свёрнутом блоке.', ts: 510000 }], removed: [] });
    await wait(80);
    await js(panel, `document.getElementById('transcript-toggle').click()`);
    await wait(80);
    assert.equal(await js(panel, `document.getElementById('live-transcript').scrollTop`), 180, 'collapsed updates preserve the reading position');
    await js(panel, `document.getElementById('transcript-expand').click()`);
    panel.webContents.send('llm:start', { requestId: 'shortcut', mode: 'assist', requestedModel: 'fixture', append: true });
    panel.webContents.send('llm:done', { suppress: true });
    await wait(80);
    assert.equal(await js(panel, `document.getElementById('panel').dataset.transcriptState`), 'compact', 'manual shortcut returns to chat');
    await js(panel, `document.getElementById('transcript-toggle').focus()`);
    panel.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' });
    panel.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
    await until(() => js(panel, `document.getElementById('panel').dataset.transcriptState === 'collapsed'`), 'keyboard accordion');

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
    assert.ok([panel, settings, catalog, onboard].every(w=>!w.isVisible()));
    await js(toolbar, 'cue.workspaceToggle()'); await wait(100);
    assert.ok([panel, settings, catalog, onboard].every(w=>w.isVisible()));
    console.log(JSON.stringify({ pass:true, checks:['native surfaces','screen selection','grouped transcript','three states','keyboard','draft','scroll retention','hidden text copy','model metadata','compact messages','silent auto','provider trust','shared appearance','catalog','onboarding','workspace visibility'], images }));
    app.emit('will-quit'); app.exit(0);
  } catch (error) { console.error(error.stack); app.emit('will-quit'); app.exit(1); }
});
setTimeout(()=>{ console.error('UI test timeout'); app.exit(1); }, 45000).unref();
