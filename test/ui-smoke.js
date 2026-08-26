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
        'provider-select', 'provider-api-key', 'base-url', 'endpoint-note', 'endpoint-trust', 'auth-mode-row',
        'settings-provider-tab', 'settings-interface-tab', 'settings-provider-pane', 'settings-interface-pane',
        'model-fast', 'model-smart', 'stt-route-group', 'stt-enabled', 'stt-api-key', 'stt-send-auth',
        'stt-model', 'stt-base-url', 'stt-endpoint-trust'
        , 'appearance-language', 'appearance-drag', 'appearance-color', 'appearance-opacity', 'appearance-opacity-value'
        , 'appearance-text-scale', 'appearance-text-scale-value'
        , 'appearance-accent', 'appearance-blur', 'appearance-blur-value', 'appearance-radius', 'appearance-radius-value', 'appearance-animations', 'appearance-presets', 'appearance-reset'
        , 'copy-btn', 'custom-tooltip'
        , 'stop-btn', 'live-dot', 'mic-activity', 'hide-btn', 'logo-btn'
        , 'stt-protocol-field', 'stt-protocol'
        , 'panel-scroll', 'composer-dock', 'composer', 'recovery-panel', 'recovery-list'
        , 'panel-topbar', 'panel-tools', 'capture-diagnostics', 'messages'
        , 'search-btn', 'catalog-scrim', 'catalog', 'settings'
      ];
      const missing = required.filter((id) => !document.getElementById(id));
      const emptyChatInitially = document.getElementById('messages').childElementCount === 0;
      const mainWindowSimplified = document.getElementById('search-btn').parentElement.id === 'panel-tools'
        && document.getElementById('more-btn').parentElement.id === 'panel-tools'
        && !document.querySelector('#live-view .view-head')
        && !document.querySelector('#answer-view .view-head')
        && getComputedStyle(document.getElementById('live-view')).borderBottomWidth === '0px'
        && getComputedStyle(document.getElementById('live-transcript')).display === 'none';
      const recoveryItem = document.querySelector('.recovery-item');
      const recoveryRedesigned = !recoveryItem || ([...recoveryItem.querySelectorAll('button')].map((button) => button.getAttribute('aria-label')).join(' ') === 'Продолжить Итог RAW Убрать'
        && getComputedStyle(recoveryItem).gridTemplateColumns !== 'none'
        && getComputedStyle(recoveryItem.querySelector('.recovery-actions')).flexWrap === 'nowrap'
        && !!recoveryItem.querySelector('.recovery-actions .dismiss.icon-only svg'));
      const resizers = [...document.querySelectorAll('.panel-resizer')];
      const resizersAvailable = resizers.length === 12
        && resizers.filter((handle) => handle.classList.contains('panel-resizer-left') || handle.classList.contains('panel-resizer-right')).every((handle) => getComputedStyle(handle).cursor === 'ew-resize')
        && resizers.filter((handle) => handle.classList.contains('panel-resizer-top') || handle.classList.contains('panel-resizer-bottom')).every((handle) => getComputedStyle(handle).cursor === 'ns-resize');
      const customControlsSkinned = document.querySelectorAll('.custom-select').length >= 3
        && document.querySelectorAll('.color-control').length === 2
        && document.querySelectorAll('.color-option').length === 20
        && !!document.getElementById('appearance-opacity').style.getPropertyValue('--range-progress')
        && getComputedStyle(document.getElementById('appearance-animations')).appearance === 'none'
        && getComputedStyle(document.querySelector('.custom-select:has(#provider-select) .custom-select-chevron')).marginLeft === 'auto'
        && getComputedStyle(document.getElementById('endpoint-trust-row')).alignItems === 'center'
        && parseFloat(getComputedStyle(document.getElementById('endpoint-note')).marginBottom) >= 5;
      document.getElementById('search-btn').click();
      await new Promise((resolve) => setTimeout(resolve, 50));
      document.getElementById('more-btn').click();
      await new Promise((resolve) => setTimeout(resolve, 50));
      const panelRect = document.getElementById('panel-wrap').getBoundingClientRect();
      const catalogRect = document.getElementById('catalog').getBoundingClientRect();
      const settingsRect = document.getElementById('settings').getBoundingClientRect();
      const sidecarsNonModal = catalogRect.right < panelRect.left
        && settingsRect.left > panelRect.right
        && getComputedStyle(document.getElementById('catalog-scrim')).pointerEvents === 'none'
        && getComputedStyle(document.getElementById('settings-scrim')).pointerEvents === 'none';
      document.getElementById('search-btn').click();
      const meetingsToggleClosed = document.getElementById('catalog-scrim').classList.contains('hidden')
        && !document.getElementById('search-btn').classList.contains('on');
      document.getElementById('search-btn').click();
      await new Promise((resolve) => setTimeout(resolve, 30));
      document.getElementById('more-btn').click();
      for (let i = 0; i < 50 && !document.getElementById('settings-scrim').classList.contains('hidden'); i++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const settingsToggleClosed = document.getElementById('settings-scrim').classList.contains('hidden')
        && !document.getElementById('more-btn').classList.contains('on');
      document.getElementById('logo-btn').click();
      await new Promise((resolve) => setTimeout(resolve, 30));
      const onboardingOpened = !document.getElementById('onboard-scrim').classList.contains('hidden')
        && document.getElementById('logo-btn').classList.contains('on');
      document.getElementById('logo-btn').click();
      await new Promise((resolve) => setTimeout(resolve, 30));
      const onboardingToggleClosed = document.getElementById('onboard-scrim').classList.contains('hidden')
        && !document.getElementById('logo-btn').classList.contains('on');
      document.getElementById('more-btn').click();
      await new Promise((resolve) => setTimeout(resolve, 30));
      const panelButtonsToggle = meetingsToggleClosed && settingsToggleClosed && onboardingOpened && onboardingToggleClosed
        && !document.getElementById('settings-scrim').classList.contains('hidden');
      const catalogCards = [...document.querySelectorAll('.catalog-item')];
      const catalogCardsSimplified = catalogCards.length > 0 && catalogCards.every((card) => {
        const labels = [...card.querySelectorAll('.catalog-action')].map((button) => button.textContent);
        return labels.length === 3 && labels.join(' ') === 'Открыть DOCX PDF'
          && !!card.querySelector('.catalog-action.primary')
          && card.querySelectorAll('.catalog-action.format').length === 2;
      });
      const providerSelect = document.getElementById('provider-select');
      providerSelect.value = 'compatible';
      providerSelect.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 50));
      const baseInput = document.getElementById('base-url');
      baseInput.value = 'http://localhost:11434/v1';
      baseInput.dispatchEvent(new Event('input', { bubbles: true }));
      const endpointNoteRect = document.getElementById('endpoint-note').getBoundingClientRect();
      const endpointTrustRect = document.getElementById('endpoint-trust-row').getBoundingClientRect();
      const endpointHelperSeparated = endpointNoteRect.bottom + 8 <= endpointTrustRect.top
        && getComputedStyle(document.getElementById('endpoint-note')).position === 'relative'
        && parseFloat(getComputedStyle(document.getElementById('endpoint-note')).paddingTop) >= 8;
      document.getElementById('model-fast').value = 'local-model';
      document.getElementById('appearance-language').value = 'ru';
      document.getElementById('appearance-color').value = '#243047';
      document.getElementById('appearance-color').dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('appearance-accent').value = '#7c8cff';
      document.getElementById('appearance-accent').dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('appearance-opacity').value = '64';
      document.getElementById('appearance-opacity').dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('appearance-text-scale').value = '20';
      document.getElementById('appearance-text-scale').dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('appearance-blur').value = '46';
      document.getElementById('appearance-blur').dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('appearance-radius').value = '22';
      document.getElementById('appearance-radius').dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('appearance-animations').checked = false;
      document.getElementById('appearance-animations').dispatchEvent(new Event('change', { bubbles: true }));
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
      const smartToggle = document.getElementById('smart-toggle');
      smartToggle.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const customTooltipWorks = !document.getElementById('custom-tooltip').classList.contains('hidden')
        && /сильную модель/i.test(document.getElementById('custom-tooltip').textContent)
        && document.getElementById('custom-tooltip').getBoundingClientRect().width > 100;
      smartToggle.dispatchEvent(new PointerEvent('pointerout', { bubbles: true }));
      return {
        missing,
        emptyChatInitially,
        mainWindowSimplified,
        recoveryRedesigned,
        resizersAvailable,
        customControlsSkinned,
        meetingIconVisible: !!document.querySelector('#search-btn svg path'),
        sidecarsNonModal,
        panelButtonsToggle,
        catalogCardsSimplified,
        invalidSettingsRemainVisible: !document.getElementById('settings-scrim').classList.contains('hidden'),
        customSelected: providerSelect.value === 'compatible',
        twoSettingsTabs: document.querySelectorAll('[data-settings-tab]').length === 2,
        customPlaceholder: baseInput.placeholder,
        authControlsVisible: !document.getElementById('auth-mode-row').classList.contains('hidden'),
        sttControlsVisible: !document.getElementById('stt-route-group').classList.contains('hidden'),
        invalidEndpointRejected: /https/i.test(document.getElementById('endpoint-note').textContent),
        endpointHelperSeparated,
        trustRevocationBlocked,
        bridgeAvailable: !!(window.cue && window.cue.settingsGet && window.cue.settingsSet && window.cue.sessionDismiss),
        validEndpointSaved: saved.provider === 'compatible'
          && saved.baseUrls.compatible === 'http://localhost:11434/v1'
          && saved.trustedBaseUrls.compatible === 'http://localhost:11434/v1'
          && saved.authModes.compatible === 'none'
          && saved.models.compatible.fast === 'local-model'
          && saved.appearance.language === 'ru'
          && saved.appearance.backgroundColor === '#243047'
          && saved.appearance.accentColor === '#7c8cff'
          && saved.appearance.backgroundOpacity === 0.64
          && saved.appearance.blurStrength === 46
          && saved.appearance.cornerRadius === 22
          && saved.appearance.animations === false
          && saved.appearance.textScale === 1.25
          && saved.appearance.catalogWidth === 440
          && saved.appearance.settingsWidth === 440,
        appearanceApplied: document.documentElement.style.getPropertyValue('--glass-bg').includes('0.64')
          && document.documentElement.style.getPropertyValue('--text-zoom') === '1.25'
          && document.documentElement.style.getPropertyValue('--panel-width') === '624px'
          && document.documentElement.style.getPropertyValue('--catalog-width') === '440px'
          && document.documentElement.style.getPropertyValue('--settings-width') === '440px'
          && document.documentElement.style.getPropertyValue('--accent') === '#7c8cff'
          && document.documentElement.style.getPropertyValue('--glass-blur') === '46px'
          && document.documentElement.style.getPropertyValue('--r-panel') === '22px'
          && document.documentElement.dataset.animations === 'off',
        sixThemesAvailable: document.querySelectorAll('#appearance-presets [data-preset]').length === 6,
        quickLabelsRussian: document.querySelector('[data-mode="say"] span:last-child').textContent === 'Что ответить?'
          && document.querySelector('[data-mode="followup"] span:last-child').textContent === 'Что спросить дальше?'
          && document.querySelector('[data-mode="recap"] span:last-child').textContent === 'Краткое резюме',
        toolbarActionsPolished: document.getElementById('copy-btn').parentElement.id === 'panel-tools'
          && !document.getElementById('zoom-in-btn')
          && !document.getElementById('zoom-out-btn')
          && !!document.getElementById('smart-toggle').dataset.tooltip
          && document.querySelectorAll('[title]').length === 0
          && getComputedStyle(document.getElementById('custom-tooltip')).position === 'fixed'
          && customTooltipWorks,
        captureControlIdle: document.getElementById('stop-btn').getAttribute('aria-pressed') === 'false'
          && document.getElementById('stop-btn').querySelector('svg path')
          && document.getElementById('live-dot').classList.contains('off')
          && document.getElementById('mic-activity').classList.contains('idle')
          && document.querySelectorAll('#mic-activity .mic-wave i').length === 5
          && !document.querySelector('#mic-activity .mic-activity-label')
          && document.getElementById('hide-btn').children.length === 1
          && document.querySelectorAll('#hide-btn .panel-toggle-icon svg rect').length === 1
          && document.getElementById('logo-btn').parentElement.id === 'panel-tools',
        panelScrollEnabled: getComputedStyle(document.getElementById('panel-scroll')).overflowY === 'auto'
          && getComputedStyle(document.getElementById('panel')).overflow === 'hidden'
          && document.getElementById('composer-dock').parentElement.id === 'panel'
          && document.getElementById('composer').parentElement.id === 'composer-dock'
          && document.getElementById('action-row').parentElement.id === 'composer-dock'
          && getComputedStyle(document.getElementById('action-row')).flexWrap === 'nowrap'
          && getComputedStyle(document.getElementById('action-row')).gap === '8px'
          && getComputedStyle(document.querySelector('#action-row .act')).borderTopWidth === '1px'
          && document.getElementById('appearance-text-scale-value').textContent === '20 px',
        partialSttPatchPreserved: afterPartialSttPatch.stt.routes.openai.model === 'whisper-custom'
          && afterPartialSttPatch.stt.routes.openai.enabled === false,
        invalidEndpointFailedClosed: afterInvalid.baseUrls.compatible === 'http://localhost:11434/v1'
      };
    })()`);

    const ok = result.missing.length === 0
      && result.emptyChatInitially
      && result.mainWindowSimplified
      && result.recoveryRedesigned
      && result.resizersAvailable
      && result.customControlsSkinned
      && result.meetingIconVisible
      && result.sidecarsNonModal
      && result.panelButtonsToggle
      && result.catalogCardsSimplified
      && result.invalidSettingsRemainVisible
      && result.customSelected
      && result.twoSettingsTabs
      && result.authControlsVisible
      && result.sttControlsVisible
      && result.invalidEndpointRejected
      && result.endpointHelperSeparated
      && result.trustRevocationBlocked
      && result.bridgeAvailable
      && result.validEndpointSaved
      && result.appearanceApplied
      && result.sixThemesAvailable
      && result.quickLabelsRussian
      && result.toolbarActionsPolished
      && result.captureControlIdle
      && result.panelScrollEnabled
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
