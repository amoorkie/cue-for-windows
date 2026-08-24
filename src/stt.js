// Speech-to-text factory. Decoupled from the LLM provider because Anthropic has
// no audio API — we transcribe with whatever audio-capable key is available, and
// fall back across providers. Returns { text, provider } or { text:'', error }.
const { pcmToWav } = require('./wav');
const { normalizeBaseURL, resolveBaseURL, STT_PROVIDERS } = require('./endpoints');

const routeCooldowns = new Map();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function isTransient(error) {
  const status = Number(error && error.status);
  return status === 408 || status === 409 || status === 429 || status >= 500 || (!status && error && error.code !== 'model_not_found');
}
async function withRetry(fn, attempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { return await fn(); }
    catch (error) {
      lastError = error;
      if (!isTransient(error) || attempt === attempts - 1) throw error;
      await sleep(400 * (2 ** attempt));
    }
  }
  throw lastError;
}

async function transcribeOpenAI(apiKey, wav, model, baseURL, authMode) {
  const OpenAI = require('openai');
  const toFile = OpenAI.toFile || require('openai/uploads').toFile;
  const client = new OpenAI({
    apiKey: apiKey || 'local-api-key',
    baseURL,
    defaultHeaders: authMode === 'none' ? { Authorization: null } : undefined
  });
  const file = await toFile(wav, 'audio.wav', { type: 'audio/wav' });
  const res = await client.audio.transcriptions.create({ file, model: model || 'whisper-1' });
  return (res.text || '').trim();
}

async function transcribeGemini(apiKey, wav, model, baseURL) {
  const { GoogleGenAI } = require('@google/genai');
  const ai = new GoogleGenAI({ apiKey, httpOptions: { baseUrl: baseURL } });
  const res = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [
      { text: 'Transcribe this audio verbatim. Return only the spoken words with no commentary. If there is no clear speech, return an empty response.' },
      { inlineData: { mimeType: 'audio/wav', data: wav.toString('base64') } }
    ] }]
  });
  return ((res && res.text) || '').trim();
}

async function transcribeCompatibleChat(apiKey, wav, model, baseURL, authMode) {
  const OpenAI = require('openai');
  const client = new OpenAI({
    apiKey: apiKey || 'local-api-key',
    baseURL,
    defaultHeaders: authMode === 'none' ? { Authorization: null } : undefined
  });
  const res = await client.chat.completions.create({
    model,
    messages: [{ role: 'user', content: [
      { type: 'text', text: 'Transcribe this audio verbatim. Return only clearly spoken words, with no commentary or completion. If multiple OTHER participants speak, prefix each line with [SPEAKER_1], [SPEAKER_2], and so on. Keep speaker numbers consistent within this clip. If there is only one speaker, use [SPEAKER_1]. If the audio is silence, noise, music, an echo, or unclear, return an empty response. Never invent or guess words.' },
      { type: 'input_audio', input_audio: { data: wav.toString('base64'), format: 'wav' } }
    ] }],
    max_tokens: 900,
    temperature: 0
  });
  const message = res && res.choices && res.choices[0] && res.choices[0].message;
  const content = message && message.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) return content.map((part) => typeof part === 'string' ? part : part && (part.text || part.content) || '').join('').trim();
  return '';
}

function createSTT(settings) {
  const keys = settings.apiKeys || {};
  const sttKeys = settings.sttApiKeys || {};
  const chain = [];
  const configurationErrors = [];
  const routes = settings.stt && settings.stt.routes ? settings.stt.routes : {};

  const preferred = STT_PROVIDERS.includes(settings.provider) ? settings.provider : null;
  const providerOrder = preferred ? [preferred, ...STT_PROVIDERS.filter((provider) => provider !== preferred)] : [...STT_PROVIDERS];
  for (const provider of providerOrder) {
    const route = routes[provider] || {};
    if (!route.enabled) continue;
    const authMode = provider === 'compatible' && route.authMode === 'none' ? 'none' : 'bearer';
    if (!route.model) {
      configurationErrors.push(provider + ' transcription model is not set.');
      continue;
    }
    try {
      const baseURL = resolveBaseURL(provider, settings, 'stt');
      if (route.baseUrl) {
        const trusted = normalizeBaseURL(route.trustedBaseUrl);
        if (trusted !== baseURL) throw new Error('custom transcription endpoint has not been trusted.');
      }
      const chatUsesCustomDestination = !!(settings.baseUrls && settings.baseUrls[provider]);
      const canReuseProviderKey = !route.baseUrl && !chatUsesCustomDestination;
      const apiKey = sttKeys[provider] || (canReuseProviderKey ? keys[provider] : '');
      if (!apiKey && authMode !== 'none') {
        if (route.baseUrl || chatUsesCustomDestination) {
          configurationErrors.push(provider + ': set a separate transcription API key for this route.');
        }
        continue;
      }
      const routeKey = `${provider}|${baseURL}|${route.model}|${route.protocol || 'transcriptions'}`;
      if ((routeCooldowns.get(routeKey) || 0) > Date.now()) continue;
      if (provider === 'gemini') {
        chain.push({ p: provider, routeKey, fn: (wav) => transcribeGemini(apiKey, wav, route.model, baseURL) });
      } else if (provider === 'compatible' && route.protocol === 'chat-audio') {
        chain.push({ p: provider, routeKey, fn: (wav) => transcribeCompatibleChat(apiKey, wav, route.model, baseURL, authMode) });
      } else {
        chain.push({ p: provider, routeKey, fn: (wav) => transcribeOpenAI(apiKey, wav, route.model, baseURL, authMode) });
      }
    } catch (error) {
      configurationErrors.push(provider + ': ' + error.message);
    }
  }

  return {
    available: chain.length > 0,
    error: configurationErrors[0] || null,
    providers: chain.map((c) => c.p),
    async transcribe(pcm) {
      if (!chain.length || !pcm || pcm.length < 3200) return { text: '' };
      const wav = pcmToWav(pcm, 16000, 1);
      let lastErr = null;
      for (const c of chain) {
        try {
          const text = await withRetry(() => c.fn(wav));
          return { text, provider: c.p };
        } catch (e) {
          if ((e && e.code === 'model_not_found') || Number(e && e.status) === 404) {
            routeCooldowns.set(c.routeKey, Date.now() + 10 * 60 * 1000);
          }
          lastErr = { status: e && e.status, code: e && e.code, message: (e && e.message) || String(e), provider: c.p };
        }
      }
      return { text: '', error: lastErr };
    }
  };
}

module.exports = { createSTT, isTransient };
