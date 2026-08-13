const path = require('path');
const os = require('os');
const { app, BrowserWindow } = require('electron');

app.setPath('userData', path.join(os.tmpdir(), 'cue-ui-smoke-' + process.pid));

require('../main');

function waitForWindow(timeoutMs = 10000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win && !win.isDestroyed() && !win.webContents.isLoading()) return resolve(win);
      if (Date.now() - started > timeoutMs) return reject(new Error('Timed out waiting for the cue window.'));
      setTimeout(poll, 100);
    };
    poll();
  });
}

app.whenReady().then(async () => {
  try {
    const win = await waitForWindow();
    const result = await win.webContents.executeJavaScript(`(async () => {
      const required = [
        'provider-seg', 'base-url', 'endpoint-note', 'endpoint-trust', 'auth-mode-row',
        'key-compatible', 'model-fast', 'model-smart', 'stt-route-group', 'stt-enabled', 'stt-api-key', 'stt-send-auth',
        'stt-model', 'stt-base-url', 'stt-endpoint-trust'
        , 'appearance-language', 'appearance-drag', 'appearance-color', 'appearance-opacity', 'appearance-opacity-value'
        , 'copy-btn'
        , 'stop-btn', 'live-dot'
        , 'stt-protocol-field', 'stt-protocol'
      ];
      const missing = required.filter((id) => !document.getElementById(id));
      document.getElementById('more-btn').click();
      await new Promise((resolve) => setTimeout(resolve, 50));
      const custom = document.querySelector('#provider-seg button[data-provider="compatible"]');
      if (custom) custom.click();
      await new Promise((resolve) => setTimeout(resolve, 50));
      const baseInput = document.getElementById('base-url');
      baseInput.value = 'http://localhost:11434/v1';
      baseInput.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('model-fast').value = 'local-model';
      document.getElementById('appearance-language').value = 'ru';
      document.getElementById('appearance-color').value = '#243047';
      document.getElementById('appearance-color').dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('appearance-opacity').value = '64';
      document.getElementById('appearance-opacity').dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('send-auth').checked = false;
      document.getElementById('endpoint-trust').checked = true;
      document.getElementById('endpoint-trust').dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('s-close').click();
      for (let i = 0; i < 50 && !document.getElementById('settings-scrim').classList.contains('hidden'); i++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const saved = await window.cue.settingsGet();
      await window.cue.settingsSet({ stt: { routes: { openai: { model: 'whisper-custom' } } } });
      await window.cue.settingsSet({ stt: { routes: { openai: { enabled: false } } } });
      const afterPartialSttPatch = await window.cue.settingsGet();

      document.getElementById('more-btn').click();
      await new Promise((resolve) => setTimeout(resolve, 30));
      document.getElementById('endpoint-trust').checked = false;
      document.getElementById('endpoint-trust').dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('s-close').click();
      await new Promise((resolve) => setTimeout(resolve, 100));
      const trustRevocationBlocked = !document.getElementById('settings-scrim').classList.contains('hidden')
        && /confirm/i.test(document.getElementById('endpoint-note').textContent);
      baseInput.value = 'http://fcevil.example/v1';
      baseInput.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('s-close').click();
      await new Promise((resolve) => setTimeout(resolve, 100));
      const afterInvalid = await window.cue.settingsGet();
      return {
        missing,
        invalidSettingsRemainVisible: !document.getElementById('settings-scrim').classList.contains('hidden'),
        customSelected: !!(custom && custom.classList.contains('on')),
        customPlaceholder: baseInput.placeholder,
        authControlsVisible: !document.getElementById('auth-mode-row').classList.contains('hidden'),
        sttControlsVisible: !document.getElementById('stt-route-group').classList.contains('hidden'),
        invalidEndpointRejected: /https/i.test(document.getElementById('endpoint-note').textContent),
        trustRevocationBlocked,
        bridgeAvailable: !!(window.cue && window.cue.settingsGet && window.cue.settingsSet),
        validEndpointSaved: saved.provider === 'compatible'
          && saved.baseUrls.compatible === 'http://localhost:11434/v1'
          && saved.trustedBaseUrls.compatible === 'http://localhost:11434/v1'
          && saved.authModes.compatible === 'none'
          && saved.models.compatible.fast === 'local-model'
          && saved.appearance.language === 'ru'
          && saved.appearance.backgroundColor === '#243047'
          && saved.appearance.backgroundOpacity === 0.64,
        appearanceApplied: document.documentElement.style.getPropertyValue('--glass-bg').includes('0.64'),
        quickLabelsRussian: document.querySelector('[data-mode="say"] span:last-child').textContent === 'Что ответить?'
          && document.querySelector('[data-mode="followup"] span:last-child').textContent === 'Что спросить дальше?'
          && document.querySelector('[data-mode="recap"] span:last-child').textContent === 'Краткое резюме',
        captureControlIdle: document.getElementById('stop-btn').getAttribute('aria-pressed') === 'false'
          && document.getElementById('stop-btn').querySelector('svg path')
          && document.getElementById('live-dot').classList.contains('off'),
        partialSttPatchPreserved: afterPartialSttPatch.stt.routes.openai.model === 'whisper-custom'
          && afterPartialSttPatch.stt.routes.openai.enabled === false,
        invalidEndpointFailedClosed: afterInvalid.baseUrls.compatible === 'http://localhost:11434/v1'
      };
    })()`);

    const ok = result.missing.length === 0
      && result.invalidSettingsRemainVisible
      && result.customSelected
      && result.authControlsVisible
      && result.sttControlsVisible
      && result.invalidEndpointRejected
      && result.trustRevocationBlocked
      && result.bridgeAvailable
      && result.validEndpointSaved
      && result.appearanceApplied
      && result.quickLabelsRussian
      && result.captureControlIdle
      && result.partialSttPatchPreserved
      && result.invalidEndpointFailedClosed;
    console.log(JSON.stringify(result));
    app.exit(ok ? 0 : 1);
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    app.exit(1);
  }
});

setTimeout(() => {
  console.error('UI smoke test timed out.');
  app.exit(1);
}, 15000).unref();
