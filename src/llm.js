const DEBUG = false; // Set to false to disable debug logging
// LLM factory — OpenAI / Anthropic / Gemini behind one streaming interface.
// stream({ system, turns:[{role,text}], imageDataUrl, maxTokens, onToken }) -> Promise<fullText>
const { normalizeBaseURL, resolveBaseURL } = require('./endpoints');

function stripDataUrl(dataUrl) {
  const m = /^data:(.+?);base64,(.*)$/s.exec(dataUrl || '');
  return m ? { mime: m[1], b64: m[2] } : null;
}

// Some compatible gateways return { code, message } instead of { error: ... }.
// Normalize only failed responses so the SDK preserves their actual reason.
async function fetchWithGatewayErrors(url, init) {
  const response = await fetch(url, init);
  if (response.status < 400) return response;
  const raw = await response.text();
  let body = raw;
  try {
    const data = JSON.parse(raw);
    if (data && !data.error && typeof data.message === 'string') body = JSON.stringify({ error: data });
  } catch { /* Keep non-JSON errors unchanged. */ }
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

async function streamOpenAI({ apiKey, model, system, turns, imageDataUrl, maxTokens, onToken, baseURL, authMode }) {
  if (DEBUG) console.log('[DEBUG LLM] streamOpenAI called', { model, baseURL, hasImage: !!imageDataUrl, maxTokens });
  const OpenAI = require('openai');
  const client = new OpenAI({
    apiKey: apiKey || 'local-api-key',
    baseURL,
    fetch: fetchWithGatewayErrors,
    timeout: 90000,
    defaultHeaders: authMode === 'none' ? { Authorization: null } : undefined
  });
  const messages = [{ role: 'system', content: system }];
  turns.forEach((t, i) => {
    const last = i === turns.length - 1;
    if (last && imageDataUrl && t.role === 'user') {
      messages.push({ role: 'user', content: [
        { type: 'text', text: t.text },
        { type: 'image_url', image_url: { url: imageDataUrl } }
      ] });
    } else {
      messages.push({ role: t.role, content: t.text });
    }
  });
  if (DEBUG) console.log('[DEBUG LLM] streamOpenAI sending request to OpenAI SDK with messages count:', messages.length);
  try {
    const stream = await client.chat.completions.create({ model, messages, stream: true, max_tokens: maxTokens });
    let full = '';
    let finishReason = null;
    for await (const part of stream) {
      if (part.error) throw new Error(part.error.message || 'API stream failed.');
      const choice = part.choices && part.choices[0];
      if (choice && choice.finish_reason) finishReason = choice.finish_reason;
      const d = part.choices && part.choices[0] && part.choices[0].delta && part.choices[0].delta.content;
      if (d) { full += d; onToken(d); }
    }
    if (finishReason === 'length') throw new Error('Ответ оборвался: модель исчерпала лимит вывода. Сократите запрос или выберите другую модель.');
    if (finishReason === 'content_filter') throw new Error('Сервис модели заблокировал ответ фильтром содержимого.');
    if (!full.trim()) throw new Error('Модель вернула пустой ответ. Повторите запрос или проверьте выбранную модель.');
    if (DEBUG) console.log('[DEBUG LLM] streamOpenAI finished successfully, total length:', full.length);
    return full;
  } catch (err) {
    if (DEBUG) console.error('[DEBUG LLM] streamOpenAI error:', err);
    throw err;
  }
}

async function streamAnthropic({ apiKey, model, system, turns, imageDataUrl, maxTokens, onToken, baseURL }) {
  if (DEBUG) console.log('[DEBUG LLM] streamAnthropic called', { model, baseURL, hasImage: !!imageDataUrl, maxTokens });
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey, baseURL });
  const messages = turns.map((t, i) => {
    const last = i === turns.length - 1;
    if (last && imageDataUrl && t.role === 'user') {
      const img = stripDataUrl(imageDataUrl);
      const content = [];
      if (img) content.push({ type: 'image', source: { type: 'base64', media_type: img.mime, data: img.b64 } });
      content.push({ type: 'text', text: t.text });
      return { role: 'user', content };
    }
    return { role: t.role, content: t.text };
  });
  if (DEBUG) console.log('[DEBUG LLM] streamAnthropic sending request to Anthropic SDK with messages count:', messages.length);
  try {
    const stream = await client.messages.create({ model, max_tokens: maxTokens, system, messages, stream: true });
    let full = '';
    for await (const ev of stream) {
      if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') { full += ev.delta.text; onToken(ev.delta.text); }
    }
    if (DEBUG) console.log('[DEBUG LLM] streamAnthropic finished successfully, total length:', full.length);
    return full;
  } catch (err) {
    if (DEBUG) console.error('[DEBUG LLM] streamAnthropic error:', err);
    throw err;
  }
}

async function streamGemini({ apiKey, model, system, turns, imageDataUrl, maxTokens, onToken, baseURL }) {
  if (DEBUG) console.log('[DEBUG LLM] streamGemini called', { model, baseURL, hasImage: !!imageDataUrl, maxTokens });
  const { GoogleGenAI } = require('@google/genai');
  const ai = new GoogleGenAI({ apiKey, httpOptions: { baseUrl: baseURL } });
  const contents = turns.map((t, i) => {
    const last = i === turns.length - 1;
    const parts = [{ text: t.text }];
    if (last && imageDataUrl && t.role === 'user') {
      const img = stripDataUrl(imageDataUrl);
      if (img) parts.push({ inlineData: { mimeType: img.mime, data: img.b64 } });
    }
    return { role: t.role === 'assistant' ? 'model' : 'user', parts };
  });
  if (DEBUG) console.log('[DEBUG LLM] streamGemini sending request to Google SDK with contents count:', contents.length);
  try {
    const stream = await ai.models.generateContentStream({
      model, contents, config: { systemInstruction: system, maxOutputTokens: maxTokens }
    });
    let full = '';
    let lastFinishReason = 'UNKNOWN';
    for await (const chunk of stream) {
      const t = chunk && chunk.text;
      if (t) { full += t; onToken(t); }
      if (chunk && chunk.candidates && chunk.candidates[0] && chunk.candidates[0].finishReason) {
        lastFinishReason = chunk.candidates[0].finishReason;
      }
    }
    if (DEBUG) console.log('[DEBUG LLM] streamGemini finished successfully, total length:', full.length, 'finishReason:', lastFinishReason);
    return full;
  } catch (err) {
    if (DEBUG) console.error('[DEBUG LLM] streamGemini error:', err);
    throw err;
  }
}

function createLLM(settings, options = {}) {
  const provider = settings.provider;
  const keys = settings.apiKeys || {};
  const apiKey = keys[provider];
  const tier = options.fast ? 'fast' : (settings.smart ? 'smart' : 'fast');
  const model = (settings.models[provider] || {})[tier];
  const configuredBaseURL = settings.baseUrls && settings.baseUrls[provider];
  const authMode = provider === 'compatible' && settings.authModes && settings.authModes.compatible === 'none' ? 'none' : 'bearer';
  let baseURL = '';
  let endpointError = null;
  try {
    baseURL = resolveBaseURL(provider, settings);
    if (configuredBaseURL) {
      const trusted = normalizeBaseURL(settings.trustedBaseUrls && settings.trustedBaseUrls[provider]);
      if (trusted !== baseURL) throw new Error('Custom endpoint has not been trusted. Confirm it again in Settings.');
    }
  }
  catch (error) { endpointError = error; }
  const noAuth = provider === 'compatible' && authMode === 'none';
  const effectiveApiKey = apiKey || (noAuth ? 'local-api-key' : '');
  const malformedBearerKey = provider === 'compatible' && !noAuth && !!apiKey && /\s/.test(apiKey);
  
  // A bounded output budget; reasoning-capable gateways may share it with reasoning.
  const maxTokens = options.maxTokens || 4096;

  const ready = !endpointError && !!model && !!effectiveApiKey && !malformedBearerKey;
  let error = null;
  if (endpointError) error = 'Invalid API Base URL: ' + endpointError.message;
  else if (!model) error = 'Set a model name for ' + provider + ' in Settings.';
  else if (malformedBearerKey) error = 'Custom API key contains spaces or line breaks. Paste only the token, or disable Bearer authentication for a local no-auth endpoint.';
  else if (!effectiveApiKey) error = 'Add an API key for ' + provider + ', or select No authentication for a compatible endpoint.';

  if (DEBUG) console.log('[DEBUG LLM] createLLM initialized:', { provider, model, baseURL, isKeyPresent: !!apiKey, ready });

  return {
    provider, model, apiKey, baseURL, error,
    ready,
    async stream(params) {
      if (DEBUG) console.log('[DEBUG LLM] stream() invoked for provider:', provider);
      const args = { apiKey: effectiveApiKey, model, maxTokens, baseURL, authMode, ...params };
      if (['openai', 'nvidia', 'compatible'].includes(provider)) {
        try { return await streamOpenAI(args); }
        catch (error) {
          if (error.code === 'INSUFFICIENT_BALANCE') {
            const host = new URL(baseURL).host;
            error.message = settings.appearance?.language === 'en'
              ? `Insufficient account balance at ${host}. Top up the API service balance to continue.`
              : `Недостаточно средств на балансе аккаунта ${host}. Пополните баланс API-сервиса, чтобы получать ответы.`;
          }
          throw error;
        }
      }
      if (provider === 'anthropic') return streamAnthropic(args);
      if (provider === 'gemini') return streamGemini(args);
      throw new Error('unknown provider: ' + provider);
    }
  };
}

module.exports = { createLLM };
