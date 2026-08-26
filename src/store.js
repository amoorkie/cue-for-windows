// Simple JSON-file settings store (avoids native modules so `npm install` stays clean).
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { OFFICIAL_BASE_URLS, PROVIDERS, STT_PROVIDERS, normalizeBaseURL } = require('./endpoints');

const FILE = path.join(app.getPath('userData'), 'cue-data.json');

const DEFAULTS = {
  provider: 'openai',
  smart: false,
  apiKeys: { openai: '', anthropic: '', gemini: '', deepgram: '', nvidia: '', compatible: '' },
  // Empty means the provider's official API. Custom values are always opt-in.
  baseUrls: { openai: '', anthropic: '', gemini: '', nvidia: '', compatible: '' },
  trustedBaseUrls: { openai: '', anthropic: '', gemini: '', nvidia: '', compatible: '' },
  authModes: { compatible: 'bearer' },
  appearance: {
    language: 'ru',
    windowDrag: true,
    backgroundColor: '#14161c',
    accentColor: '#3c83f5',
    backgroundOpacity: 0.72,
    blurStrength: 40,
    cornerRadius: 24,
    animations: true,
    textScale: 1,
    panelWidth: 624,
    sidecarWidth: 440,
    catalogWidth: 440,
    settingsWidth: 440,
    panelHeight: 540,
    catalogHeight: 690,
    settingsHeight: 690,
    panelOffsetY: 0,
    catalogTop: 14,
    settingsTop: 14,
  },
  sttApiKeys: { openai: '', gemini: '', compatible: '' },
  models: {
    openai: { fast: 'gpt-4o-mini', smart: 'gpt-4o' },
    anthropic: { fast: 'claude-3-5-haiku-latest', smart: 'claude-3-5-sonnet-latest' },
    gemini: { fast: 'gemini-2.5-flash', smart: 'gemini-2.5-pro' },
    nvidia: { fast: 'meta/llama-3.2-11b-vision-instruct', smart: 'meta/llama-3.2-90b-vision-instruct' },
    compatible: { fast: '', smart: '' }
  },
  stt: {
    provider: 'openai',
    routes: {
      openai: { enabled: true, baseUrl: '', trustedBaseUrl: '', model: 'whisper-1', authMode: 'bearer' },
      gemini: { enabled: false, baseUrl: '', trustedBaseUrl: '', model: 'gemini-2.5-flash', authMode: 'bearer' },
      compatible: { enabled: false, baseUrl: '', trustedBaseUrl: '', model: '', authMode: 'bearer', protocol: 'transcriptions' }
    }
  }
};

let data = null;

function normalizeAppearance(input) {
  const value = input && typeof input === 'object' ? input : {};
  const color = typeof value.backgroundColor === 'string' && /^#[0-9a-f]{6}$/i.test(value.backgroundColor.trim())
    ? value.backgroundColor.trim().toLowerCase() : DEFAULTS.appearance.backgroundColor;
  const rawOpacity = Number(value.backgroundOpacity);
  const opacity = Number.isFinite(rawOpacity) ? Math.min(0.98, Math.max(0.2, rawOpacity)) : DEFAULTS.appearance.backgroundOpacity;
  const accentColor = typeof value.accentColor === 'string' && /^#[0-9a-f]{6}$/i.test(value.accentColor.trim())
    ? value.accentColor.trim().toLowerCase() : DEFAULTS.appearance.accentColor;
  const rawBlur = Number(value.blurStrength);
  const blurStrength = Number.isFinite(rawBlur) ? Math.min(60, Math.max(0, rawBlur)) : DEFAULTS.appearance.blurStrength;
  const rawRadius = Number(value.cornerRadius);
  const cornerRadius = Number.isFinite(rawRadius) ? Math.min(32, Math.max(10, rawRadius)) : DEFAULTS.appearance.cornerRadius;
  const rawTextScale = Number(value.textScale);
  const textScale = Number.isFinite(rawTextScale) ? Math.min(1.5, Math.max(0.75, rawTextScale)) : DEFAULTS.appearance.textScale;
  const rawPanelWidth = Number(value.panelWidth);
  const panelWidth = Number.isFinite(rawPanelWidth) ? Math.min(760, Math.max(520, rawPanelWidth)) : DEFAULTS.appearance.panelWidth;
  const rawSidecarWidth = Number(value.sidecarWidth);
  const sidecarWidth = Number.isFinite(rawSidecarWidth) ? Math.min(520, Math.max(300, rawSidecarWidth)) : DEFAULTS.appearance.sidecarWidth;
  const dimension = (key, fallback, min, max) => {
    const raw = Number(value[key]);
    return Math.round(Number.isFinite(raw) ? Math.min(max, Math.max(min, raw)) : fallback);
  };
  return {
    language: value.language === 'en' ? 'en' : 'ru',
    windowDrag: value.windowDrag !== false,
    backgroundColor: color,
    accentColor,
    backgroundOpacity: Number(opacity.toFixed(2)),
    blurStrength: Math.round(blurStrength),
    cornerRadius: Math.round(cornerRadius),
    animations: value.animations !== false,
    textScale: Number(textScale.toFixed(2)),
    panelWidth: Math.round(panelWidth),
    sidecarWidth: Math.round(sidecarWidth),
    catalogWidth: dimension('catalogWidth', sidecarWidth, 300, 520),
    settingsWidth: dimension('settingsWidth', sidecarWidth, 300, 520),
    panelHeight: dimension('panelHeight', DEFAULTS.appearance.panelHeight, 280, 900),
    catalogHeight: dimension('catalogHeight', DEFAULTS.appearance.catalogHeight, 320, 1100),
    settingsHeight: dimension('settingsHeight', DEFAULTS.appearance.settingsHeight, 320, 1100),
    panelOffsetY: dimension('panelOffsetY', DEFAULTS.appearance.panelOffsetY, -8, 220),
    catalogTop: dimension('catalogTop', DEFAULTS.appearance.catalogTop, 4, 260),
    settingsTop: dimension('settingsTop', DEFAULTS.appearance.settingsTop, 4, 260)
  };
}

function normalizeBaseUrls(input, strict) {
  const out = {};
  for (const provider of PROVIDERS) {
    const original = input && input[provider];
    try {
      const normalized = normalizeBaseURL(original);
      out[provider] = normalized && normalized === OFFICIAL_BASE_URLS[provider] ? '' : normalized;
    }
    catch (error) {
      if (strict) throw new Error(provider + ' Base URL ' + error.message);
      // Fail closed: preserve an invalid stored value so request creation rejects it.
      out[provider] = original === undefined || original === null ? '' : String(original).trim();
    }
  }
  return out;
}

function normalizeTrustedBaseUrls(input) {
  const out = {};
  for (const provider of PROVIDERS) {
    try { out[provider] = normalizeBaseURL(input && input[provider]); }
    catch { out[provider] = ''; }
  }
  return out;
}

function normalizeSttRoutes(input, strict) {
  const out = {};
  for (const provider of STT_PROVIDERS) {
    const defaults = DEFAULTS.stt.routes[provider];
    const route = { ...defaults, ...((input && input[provider]) || {}) };
    const original = route.baseUrl;
    try {
      const normalized = normalizeBaseURL(original);
      route.baseUrl = normalized && normalized === OFFICIAL_BASE_URLS[provider] ? '' : normalized;
    } catch (error) {
      if (strict) throw new Error(provider + ' transcription Base URL ' + error.message);
      route.baseUrl = original === undefined || original === null ? '' : String(original).trim();
    }
    try { route.trustedBaseUrl = normalizeBaseURL(route.trustedBaseUrl); }
    catch { route.trustedBaseUrl = ''; }
    route.enabled = !!route.enabled;
    route.model = String(route.model || '').trim();
    route.authMode = provider === 'compatible' && route.authMode === 'none' ? 'none' : 'bearer';
    route.protocol = provider === 'compatible' && route.protocol === 'chat-audio' ? 'chat-audio' : 'transcriptions';
    out[provider] = route;
  }
  return out;
}

function validateTrustedDestination(baseUrl, trustedBaseUrl, label) {
  if (!baseUrl) return;
  if (normalizeBaseURL(trustedBaseUrl) !== baseUrl) {
    throw new Error(label + ' must be explicitly trusted before API keys or data can be sent to it.');
  }
}

function deepMerge(base, over) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const k of Object.keys(over || {})) {
    if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]) && typeof base[k] === 'object') {
      out[k] = deepMerge(base[k], over[k]);
    } else {
      out[k] = over[k];
    }
  }
  return out;
}

function load() {
  if (data) return data;
  try { data = deepMerge(DEFAULTS, JSON.parse(fs.readFileSync(FILE, 'utf8'))); }
  catch { data = deepMerge(DEFAULTS, {}); }
  data.baseUrls = normalizeBaseUrls(data.baseUrls, false);
  data.trustedBaseUrls = normalizeTrustedBaseUrls(data.trustedBaseUrls);
  data.stt.provider = STT_PROVIDERS.includes(data.stt && data.stt.provider) ? data.stt.provider : DEFAULTS.stt.provider;
  data.stt.routes = normalizeSttRoutes(data.stt && data.stt.routes, false);
  if (data.sttModel) {
    data.stt.routes.openai.model = String(data.sttModel).trim() || data.stt.routes.openai.model;
    delete data.sttModel;
  }
  data.authModes.compatible = data.authModes.compatible === 'none' ? 'none' : 'bearer';
  data.appearance = normalizeAppearance(data.appearance);
  
  // Auto-switch provider if the current one is not configured, but another one is.
  const hasUsableConfig = (provider) => {
    if (provider !== 'compatible') return !!data.apiKeys[provider];
    const tier = data.smart ? 'smart' : 'fast';
    return !!data.baseUrls.compatible
      && !!(data.models.compatible && data.models.compatible[tier])
      && (!!data.apiKeys.compatible || data.authModes.compatible === 'none');
  };
  if (!STT_PROVIDERS.includes(data.provider) || !hasUsableConfig(data.provider)) {
    const active = STT_PROVIDERS.find(hasUsableConfig);
    if (active) {
      data.provider = active;
      // We don't save() here so we don't spam disk, it will persist on next save.
    }
  }
  if (!STT_PROVIDERS.includes(data.provider)) data.provider = 'openai';
  data.stt.provider = data.provider;
  for (const provider of STT_PROVIDERS) {
    const route = data.stt.routes[provider];
    route.enabled = provider === data.provider;
    if (!route.enabled) continue;
    route.baseUrl = data.baseUrls[provider];
    route.trustedBaseUrl = data.trustedBaseUrls[provider];
    route.authMode = provider === 'compatible' ? data.authModes.compatible : 'bearer';
    data.sttApiKeys[provider] = data.apiKeys[provider];
  }
  
  return data;
}
function save(nextData) { fs.writeFileSync(FILE, JSON.stringify(nextData, null, 2)); }

module.exports = {
  getSettings() { return load(); },
  setSettings(patch) {
    load();
    const next = { ...(patch || {}) };
    const hasBaseUrlPatch = patch && Object.prototype.hasOwnProperty.call(patch, 'baseUrls');
    const hasTrustedUrlPatch = patch && Object.prototype.hasOwnProperty.call(patch, 'trustedBaseUrls');
    if (hasBaseUrlPatch || hasTrustedUrlPatch) {
      next.baseUrls = normalizeBaseUrls({ ...data.baseUrls, ...(patch.baseUrls || {}) }, true);
      next.trustedBaseUrls = normalizeTrustedBaseUrls({ ...data.trustedBaseUrls, ...(patch.trustedBaseUrls || {}) });
      for (const provider of PROVIDERS) {
        validateTrustedDestination(next.baseUrls[provider], next.trustedBaseUrls[provider], provider + ' Base URL');
      }
    }
    if (patch && Object.prototype.hasOwnProperty.call(patch, 'stt')) {
      const routePatch = (patch.stt && patch.stt.routes) || {};
      const mergedRoutes = {};
      for (const provider of STT_PROVIDERS) {
        mergedRoutes[provider] = { ...data.stt.routes[provider], ...(routePatch[provider] || {}) };
      }
      const sttProvider = patch.stt && patch.stt.provider !== undefined ? patch.stt.provider : data.stt.provider;
      if (!STT_PROVIDERS.includes(sttProvider)) throw new Error('Unknown transcription provider: ' + sttProvider);
      next.stt = { ...data.stt, ...(patch.stt || {}), provider: sttProvider, routes: normalizeSttRoutes(mergedRoutes, true) };
      for (const provider of STT_PROVIDERS) {
        const route = next.stt.routes[provider];
        if (route.enabled) validateTrustedDestination(route.baseUrl, route.trustedBaseUrl, provider + ' transcription Base URL');
        if (route.enabled && provider === 'compatible' && !route.baseUrl) {
          throw new Error('compatible transcription Base URL is required when the route is enabled.');
        }
      }
    }
    if (patch && patch.authModes) next.authModes = { ...patch.authModes, compatible: patch.authModes.compatible === 'none' ? 'none' : 'bearer' };
    if (patch && Object.prototype.hasOwnProperty.call(patch, 'appearance')) next.appearance = normalizeAppearance({ ...data.appearance, ...(patch.appearance || {}) });
    const updated = deepMerge(data, next);
    updated.appearance = normalizeAppearance(updated.appearance);
    save(updated);
    data = updated;
    return data;
  }
};
