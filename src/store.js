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
    backgroundOpacity: 0.72
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
    routes: {
      openai: { enabled: true, baseUrl: '', trustedBaseUrl: '', model: 'whisper-1', authMode: 'bearer' },
      gemini: { enabled: true, baseUrl: '', trustedBaseUrl: '', model: 'gemini-2.5-flash', authMode: 'bearer' },
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
  const opacity = Number.isFinite(rawOpacity) ? Math.min(0.95, Math.max(0.2, rawOpacity)) : DEFAULTS.appearance.backgroundOpacity;
  return {
    language: value.language === 'en' ? 'en' : 'ru',
    windowDrag: value.windowDrag !== false,
    backgroundColor: color,
    backgroundOpacity: Number(opacity.toFixed(2))
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
  if (!hasUsableConfig(data.provider)) {
    const validProviders = PROVIDERS;
    const active = validProviders.find(hasUsableConfig);
    if (active) {
      data.provider = active;
      // We don't save() here so we don't spam disk, it will persist on next save.
    }
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
      next.stt = { ...data.stt, ...(patch.stt || {}), routes: normalizeSttRoutes(mergedRoutes, true) };
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
