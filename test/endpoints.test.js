const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { normalizeBaseURL, resolveBaseURL, isLocalEndpoint } = require('../src/endpoints');
const { createLLM } = require('../src/llm');
const { createSTT } = require('../src/stt');

function settings(overrides = {}) {
  return {
    provider: 'openai',
    smart: false,
    apiKeys: { openai: 'test-key', anthropic: '', gemini: '', nvidia: '', compatible: '' },
    baseUrls: { openai: '', anthropic: '', gemini: '', nvidia: '', compatible: '' },
    trustedBaseUrls: { openai: '', anthropic: '', gemini: '', nvidia: '', compatible: '' },
    authModes: { compatible: 'bearer' },
    sttApiKeys: { openai: '', gemini: '', compatible: '' },
    models: {
      openai: { fast: 'gpt-test', smart: 'gpt-test-smart' },
      anthropic: { fast: 'claude-test', smart: 'claude-test-smart' },
      gemini: { fast: 'gemini-test', smart: 'gemini-test-smart' },
      nvidia: { fast: 'nvidia-test', smart: 'nvidia-test-smart' },
      compatible: { fast: 'local-test', smart: 'local-test-smart' }
    },
    stt: {
      routes: {
        openai: { enabled: true, baseUrl: '', trustedBaseUrl: '', model: 'whisper-1', authMode: 'bearer' },
        gemini: { enabled: false, baseUrl: '', trustedBaseUrl: '', model: 'gemini-test', authMode: 'bearer' },
        compatible: { enabled: false, baseUrl: '', trustedBaseUrl: '', model: '', authMode: 'bearer' }
      }
    },
    ...overrides
  };
}

async function withLocalServer(handler, run) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try { return await run('http://127.0.0.1:' + port + '/v1'); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test('normalizes HTTPS endpoints and removes trailing slashes', () => {
  assert.equal(normalizeBaseURL(' https://gateway.example/v1/// '), 'https://gateway.example/v1');
});

test('allows HTTP only for same-computer loopback endpoints', () => {
  assert.equal(normalizeBaseURL('http://localhost:11434/v1/'), 'http://localhost:11434/v1');
  assert.equal(isLocalEndpoint('http://[::1]:8000/v1'), true);
  assert.throws(() => normalizeBaseURL('http://192.168.1.20:8000/v1'), /must use HTTPS/);
  assert.throws(() => normalizeBaseURL('http://api.example/v1'), /must use HTTPS/);
  assert.throws(() => normalizeBaseURL('http://fcevil.example/v1'), /must use HTTPS/);
});

test('rejects credentials, query strings, and non-HTTP schemes', () => {
  assert.throws(() => normalizeBaseURL('https://user:pass@example.com/v1'), /must not contain credentials/);
  assert.throws(() => normalizeBaseURL('https://example.com/v1?token=x'), /query string/);
  assert.throws(() => normalizeBaseURL('file:///tmp/api'), /must use https/);
});

test('uses fixed official URLs and keeps chat and STT routes separate', () => {
  const value = settings({
    baseUrls: { openai: 'https://chat-gateway.example/v1' },
    stt: { routes: { openai: { enabled: true, baseUrl: '', trustedBaseUrl: '', model: 'whisper-1' } } }
  });
  assert.equal(resolveBaseURL('openai', value), 'https://chat-gateway.example/v1');
  assert.equal(resolveBaseURL('openai', value, 'stt'), 'https://api.openai.com/v1');
  assert.throws(() => resolveBaseURL('compatible', settings({ provider: 'compatible' })), /Base URL is required/);
});

test('fails closed for untrusted custom LLM endpoints', () => {
  const baseURL = 'https://gateway.example/v1';
  const untrusted = settings({ baseUrls: { openai: baseURL } });
  assert.equal(createLLM(untrusted).ready, false);
  assert.match(createLLM(untrusted).error, /has not been trusted/);

  const trusted = settings({
    baseUrls: { openai: baseURL },
    trustedBaseUrls: { openai: baseURL }
  });
  assert.equal(createLLM(trusted).ready, true);
  assert.equal(createLLM(trusted).baseURL, baseURL);
});

test('fails closed for an invalid stored endpoint instead of falling back to official API', () => {
  const invalid = settings({
    baseUrls: { openai: 'http://fcevil.example/v1' },
    trustedBaseUrls: { openai: 'http://fcevil.example/v1' }
  });
  const llm = createLLM(invalid);
  assert.equal(llm.ready, false);
  assert.match(llm.error, /must use HTTPS/);
});

test('supports an explicit no-auth OpenAI-compatible profile', () => {
  const baseURL = 'http://localhost:11434/v1';
  const value = settings({
    provider: 'compatible',
    apiKeys: { openai: '', compatible: '' },
    baseUrls: { compatible: baseURL },
    trustedBaseUrls: { compatible: baseURL },
    authModes: { compatible: 'none' }
  });
  const llm = createLLM(value);
  assert.equal(llm.ready, true);
  assert.equal(llm.baseURL, baseURL);
});

test('fails closed for an untrusted custom transcription endpoint', () => {
  const baseURL = 'https://speech.example/v1';
  const value = settings({
    stt: { routes: {
      openai: { enabled: true, baseUrl: baseURL, trustedBaseUrl: '', model: 'whisper-1' },
      gemini: { enabled: false, baseUrl: '', trustedBaseUrl: '', model: 'gemini-test' },
      compatible: { enabled: false, baseUrl: '', trustedBaseUrl: '', model: '' }
    } }
  });
  const stt = createSTT(value);
  assert.equal(stt.available, false);
  assert.match(stt.error, /has not been trusted/);
});

test('does not reuse a chat credential for a custom transcription destination', () => {
  const baseURL = 'https://speech.example/v1';
  const value = settings({
    apiKeys: { openai: 'chat-only-key' },
    sttApiKeys: { openai: '' },
    stt: { routes: {
      openai: { enabled: true, baseUrl: baseURL, trustedBaseUrl: baseURL, model: 'whisper-1' },
      gemini: { enabled: false, baseUrl: '', trustedBaseUrl: '', model: 'gemini-test' },
      compatible: { enabled: false, baseUrl: '', trustedBaseUrl: '', model: '' }
    } }
  });
  const stt = createSTT(value);
  assert.equal(stt.available, false);
  assert.match(stt.error, /separate transcription API key/);
});

test('keeps backward-compatible provider-key fallback for official transcription API', () => {
  const stt = createSTT(settings());
  assert.equal(stt.available, true);
  assert.deepEqual(stt.providers, ['openai']);
});

test('does not send a custom chat credential to the official transcription API', () => {
  const baseURL = 'https://chat-gateway.example/v1';
  const value = settings({
    apiKeys: { openai: 'gateway-key' },
    baseUrls: { openai: baseURL },
    trustedBaseUrls: { openai: baseURL },
    sttApiKeys: { openai: '' }
  });
  const stt = createSTT(value);
  assert.equal(stt.available, false);
  assert.match(stt.error, /separate transcription API key/);
});

test('supports explicitly enabled no-auth compatible transcription', () => {
  const baseURL = 'http://127.0.0.1:8000/v1';
  const value = settings({
    provider: 'compatible',
    apiKeys: { openai: '', compatible: '' },
    authModes: { compatible: 'none' },
    stt: { routes: {
      openai: { enabled: false, baseUrl: '', trustedBaseUrl: '', model: 'whisper-1' },
      gemini: { enabled: false, baseUrl: '', trustedBaseUrl: '', model: 'gemini-test' },
      compatible: { enabled: true, baseUrl: baseURL, trustedBaseUrl: baseURL, model: 'whisper-local', authMode: 'none' }
    } }
  });
  const stt = createSTT(value);
  assert.equal(stt.available, true);
  assert.deepEqual(stt.providers, ['compatible']);
});

test('streams through a local OpenAI-compatible chat endpoint without Authorization', async () => {
  let request = null;
  await withLocalServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      request = { url: req.url, authorization: req.headers.authorization, body: JSON.parse(body) };
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end('data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: [DONE]\n\n');
    });
  }, async (baseURL) => {
    const value = settings({
      provider: 'compatible',
      apiKeys: { openai: '', compatible: '' },
      baseUrls: { compatible: baseURL },
      trustedBaseUrls: { compatible: baseURL },
      authModes: { compatible: 'none' }
    });
    const tokens = [];
    const full = await createLLM(value).stream({
      system: 'system', turns: [{ role: 'user', text: 'hi' }], imageDataUrl: null, onToken: (token) => tokens.push(token)
    });
    assert.equal(full, 'hello');
    assert.deepEqual(tokens, ['hello']);
  });
  assert.equal(request.url, '/v1/chat/completions');
  assert.equal(request.authorization, undefined);
  assert.equal(request.body.model, 'local-test');
  assert.equal(request.body.stream, true);
});

test('preserves flat gateway balance errors and explains them in Russian', async () => {
  let requests = 0;
  await withLocalServer((req, res) => {
    requests++;
    res.writeHead(403, { 'Content-Type': 'application/json', 'x-request-id': 'balance-test' });
    res.end(JSON.stringify({ code: 'INSUFFICIENT_BALANCE', message: 'Insufficient account balance' }));
  }, async (baseURL) => {
    const llm = createLLM(settings({ baseUrls: { openai: baseURL }, trustedBaseUrls: { openai: baseURL } }));
    await assert.rejects(llm.stream({ system: 'test', turns: [{ role: 'user', text: 'hi' }], onToken: () => assert.fail('No tokens expected') }), error => {
      assert.equal(error.status, 403);
      assert.equal(error.code, 'INSUFFICIENT_BALANCE');
      assert.equal(error.request_id, 'balance-test');
      assert.match(error.message, /Недостаточно средств.*127\.0\.0\.1/);
      assert.doesNotMatch(error.message, /no body|test-key/);
      return true;
    });
  });
  assert.equal(requests, 1, 'balance errors should not be retried');
});

test('preserves standard OpenAI authentication errors', async () => {
  await withLocalServer((req, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'invalid_api_key', message: 'Invalid API key' } }));
  }, async (baseURL) => {
    const llm = createLLM(settings({ baseUrls: { openai: baseURL }, trustedBaseUrls: { openai: baseURL } }));
    await assert.rejects(llm.stream({ system: 'test', turns: [], onToken: () => {} }), error => error.status === 401 && error.code === 'invalid_api_key' && /Invalid API key/.test(error.message));
  });
});

test('keeps non-JSON gateway error explanations', async () => {
  await withLocalServer((req, res) => { res.writeHead(403, { 'Content-Type': 'text/plain' }); res.end('Account disabled'); }, async (baseURL) => {
    const llm = createLLM(settings({ baseUrls: { openai: baseURL }, trustedBaseUrls: { openai: baseURL } }));
    await assert.rejects(llm.stream({ system: 'test', turns: [], onToken: () => {} }), error => error.status === 403 && /Account disabled/.test(error.message));
  });
});

test('transcribes through an explicitly configured compatible STT endpoint without Authorization', async () => {
  let request = null;
  await withLocalServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      request = {
        url: req.url,
        authorization: req.headers.authorization,
        contentType: req.headers['content-type'],
        body: Buffer.concat(chunks).toString('utf8')
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ text: 'transcribed' }));
    });
  }, async (baseURL) => {
    const value = settings({
      provider: 'compatible',
      apiKeys: { openai: '', compatible: '' },
      authModes: { compatible: 'none' },
      stt: { routes: {
        openai: { enabled: false, baseUrl: '', trustedBaseUrl: '', model: 'whisper-1' },
        gemini: { enabled: false, baseUrl: '', trustedBaseUrl: '', model: 'gemini-test' },
        compatible: { enabled: true, baseUrl: baseURL, trustedBaseUrl: baseURL, model: 'whisper-local', authMode: 'none' }
      } }
    });
    const result = await createSTT(value).transcribe(Buffer.alloc(4000, 1));
    assert.deepEqual(result, { text: 'transcribed', provider: 'compatible' });
  });
  assert.equal(request.url, '/v1/audio/transcriptions');
  assert.equal(request.authorization, undefined);
  assert.match(request.contentType, /^multipart\/form-data; boundary=/);
  assert.match(request.body, /whisper-local/);
});

test('rejects empty and truncated chat streams instead of reporting success', async () => {
  for (const choice of [{ delta: {}, finish_reason: 'stop' }, { delta: { content: 'Partial' }, finish_reason: 'length' }]) {
    await withLocalServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end('data: ' + JSON.stringify({ choices: [choice] }) + '\n\ndata: [DONE]\n\n');
    }, async (baseURL) => {
      const value = settings({ provider: 'openai', baseUrls: { openai: baseURL }, trustedBaseUrls: { openai: baseURL } });
      await assert.rejects(createLLM(value).stream({ system: 'test', turns: [{ role: 'user', text: 'test' }], onToken: () => {} }), /пустой ответ|исчерпала лимит/);
    });
  }
});

test('transcribes through a compatible chat-audio route', async () => {
  let request = null;
  await withLocalServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      request = { url: req.url, authorization: req.headers.authorization, body: JSON.parse(body) };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'hello from audio' } }] }));
    });
  }, async (baseURL) => {
    const value = settings({
      provider: 'compatible',
      apiKeys: { openai: '', compatible: 'chat-key' },
      sttApiKeys: { openai: '', gemini: '', compatible: 'chat-key' },
      baseUrls: { compatible: baseURL },
      trustedBaseUrls: { compatible: baseURL },
      stt: { routes: {
        openai: { enabled: false, baseUrl: '', trustedBaseUrl: '', model: 'whisper-1' },
        gemini: { enabled: false, baseUrl: '', trustedBaseUrl: '', model: 'gemini-test' },
        compatible: { enabled: true, baseUrl: baseURL, trustedBaseUrl: baseURL, model: 'gemini-3-flash', authMode: 'bearer', protocol: 'chat-audio' }
      } }
    });
    const result = await createSTT(value).transcribe(Buffer.alloc(4000, 1));
    assert.deepEqual(result, { text: 'hello from audio', provider: 'compatible' });
  });
  assert.equal(request.url, '/v1/chat/completions');
  assert.equal(request.authorization, 'Bearer chat-key');
  assert.equal(request.body.model, 'gemini-3-flash');
  assert.equal(request.body.messages[0].content[1].type, 'input_audio');
});


test('stream metadata reports the API model independently of the requested alias', async () => {
  await withLocalServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end('data: ' + JSON.stringify({ model: 'actual-model-revision', choices: [{ delta: { content: 'hello' } }] }) + '\n\ndata: [DONE]\n\n');
  }, async baseURL => {
    const metadata = [];
    const llm = createLLM(settings({ baseUrls: { openai: baseURL }, trustedBaseUrls: { openai: baseURL } }));
    const requested = llm.model;
    await llm.stream({ system: 'test', turns: [], onToken() {}, onMetadata: data => metadata.push(data) });
    assert.equal(llm.model, requested);
    assert.deepEqual(metadata, [{ model: 'actual-model-revision' }]);
  });
});
