const { isIP } = require('net');

const OFFICIAL_BASE_URLS = Object.freeze({
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  gemini: 'https://generativelanguage.googleapis.com',
  nvidia: 'https://integrate.api.nvidia.com/v1'
});

const PROVIDERS = Object.freeze([...Object.keys(OFFICIAL_BASE_URLS), 'compatible']);
const STT_PROVIDERS = Object.freeze(['openai', 'gemini', 'compatible']);

function isLoopbackIPv4(hostname) {
  const parts = hostname.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const octets = parts.map(Number);
  if (octets.some((part) => part < 0 || part > 255)) return false;
  return octets[0] === 127;
}

function isLocalHostname(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  const ipVersion = isIP(host);
  return host === 'localhost'
    || host.endsWith('.localhost')
    || host === 'host.docker.internal'
    || (ipVersion === 4 && isLoopbackIPv4(host))
    || (ipVersion === 6 && host === '::1');
}

function normalizeBaseURL(value) {
  if (value === undefined || value === null || String(value).trim() === '') return '';
  if (typeof value !== 'string') throw new Error('must be a URL string.');

  let url;
  try { url = new URL(value.trim()); }
  catch { throw new Error('must be a complete URL such as https://host.example/v1.'); }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('must use https://, or http:// for a local endpoint.');
  }
  if (url.username || url.password) throw new Error('must not contain credentials.');
  if (url.search || url.hash) throw new Error('must not contain a query string or fragment.');
  if (url.protocol === 'http:' && !isLocalHostname(url.hostname)) {
    throw new Error('must use HTTPS unless the endpoint is on this computer (localhost/loopback).');
  }

  const path = url.pathname.replace(/\/+$/, '');
  return url.origin + (path && path !== '/' ? path : '');
}

function resolveBaseURL(provider, settings, route = 'llm') {
  if (!PROVIDERS.includes(provider)) throw new Error('Unknown API provider: ' + provider);
  if (route === 'stt' && !STT_PROVIDERS.includes(provider)) throw new Error('Provider does not support transcription: ' + provider);
  const configured = route === 'stt'
    ? settings && settings.stt && settings.stt.routes && settings.stt.routes[provider] && settings.stt.routes[provider].baseUrl
    : settings && settings.baseUrls && settings.baseUrls[provider];
  const normalized = normalizeBaseURL(configured);
  if (normalized) return normalized;
  if (OFFICIAL_BASE_URLS[provider]) return OFFICIAL_BASE_URLS[provider];
  throw new Error((route === 'stt' ? 'Transcription Base URL' : 'API Base URL') + ' is required for the compatible provider.');
}

function isLocalEndpoint(value) {
  if (!value) return false;
  try { return isLocalHostname(new URL(value).hostname); }
  catch { return false; }
}

module.exports = { OFFICIAL_BASE_URLS, PROVIDERS, STT_PROVIDERS, normalizeBaseURL, resolveBaseURL, isLocalEndpoint };
