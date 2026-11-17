import { createGeminiClient } from './gemini-client';
import { ConfigService } from '@nestjs/config';
import { AiRegistryService } from './ai-registry.service';
import { AiError, providerError } from './ai.error';
import { ErrorCode } from '../../shared/sdk/errors/error-codes.enum';

describe('Gemini pinned transport client', () => {
  const params = {
    model: 'gemini-test',
    contents: [{ role: 'user', parts: [{ text: 'Explain loops' }] }],
    config: { maxOutputTokens: 100, systemInstruction: 'Help the learner reason' },
  };

  it('uses the injected secure transport and keeps the key out of URLs', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Answer' }] } }],
    })));
    const client = createGeminiClient('https://generativelanguage.googleapis.com', 'synthetic-test-key', 1000, fetchImpl);
    const response = await client.models.generateContent(params);
    expect(response.candidates?.[0].finishReason).toBe('STOP');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent');
    expect(url).not.toContain('synthetic-test-key');
    expect(init.headers['x-goog-api-key']).toBe('synthetic-test-key');
    expect(JSON.parse(init.body)).toMatchObject({
      systemInstruction: { parts: [{ text: 'Help the learner reason' }] },
      generationConfig: { maxOutputTokens: 100 },
    });
  });

  it('streams split UTF-8/SSE events and cancels the reader on completion', async () => {
    const text = 'data: {"candidates":[{"content":{"parts":[{"text":"Xin chào"}]}}]}\r\n\r\ndata: {"candidates":[{"finishReason":"STOP"}]}\r\n\r\n';
    const bytes = new TextEncoder().encode(text);
    const fetchImpl = jest.fn().mockResolvedValue(new Response(new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3));
        controller.close();
      },
    })));
    const client = createGeminiClient('https://generativelanguage.googleapis.com', 'test-key', 1000, fetchImpl);
    const chunks = [];
    for await (const chunk of await client.models.generateContentStream(params)) chunks.push(chunk);
    expect(chunks[0].candidates?.[0].content?.parts?.[0].text).toBe('Xin chào');
    expect(chunks[1].candidates?.[0].finishReason).toBe('STOP');
    expect(fetchImpl.mock.calls[0][0]).toContain(':streamGenerateContent?alt=sse');
  });

  it('does not retry upstream failures or retain their private response bodies', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response('synthetic-private-provider-body', {
      status: 503, headers: { 'Retry-After': '2' },
    }));
    const client = createGeminiClient('https://generativelanguage.googleapis.com', 'test-key', 1000, fetchImpl);
    await expect(client.models.generateContent(params)).rejects.toMatchObject({
      status: 503, message: 'Gemini provider request failed',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects path traversal in model IDs before sending a request', async () => {
    const fetchImpl = jest.fn();
    const client = createGeminiClient('https://generativelanguage.googleapis.com', 'test-key', 1000, fetchImpl);
    await expect(client.models.generateContent({ ...params, model: '../metadata' })).rejects.toThrow('Invalid Gemini model ID');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  const googleError = (info: Record<string, unknown> = {}) => ({ error: {
    code: 400, message: 'synthetic-private-error-key',
    details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', domain: 'googleapis.com',
      reason: 'API_KEY_INVALID', metadata: { apiKey: 'synthetic-private-error-key' }, ...info }],
  } });

  it('recognizes bounded Google auth metadata without retaining private response content', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response(JSON.stringify(googleError()), { status: 400 }));
    const client = createGeminiClient('https://generativelanguage.googleapis.com', 'fixture-key', 1000, fetchImpl);
    let failure: unknown;
    try { await client.models.list(); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(AiError);
    expect(failure).toMatchObject({ code: ErrorCode.AI_PROVIDER_AUTH_FAILED,
      retryable: false, upstreamStatus: 400 });
    expect((failure as AiError).getStatus()).toBe(503);
    expect(JSON.stringify(failure)).not.toContain('synthetic-private-error-key');
    expect(JSON.stringify(failure)).not.toContain('API_KEY_INVALID');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    { '@type': 'untrusted.ErrorInfo' }, { domain: 'untrusted.example' },
    { reason: 'MODEL_NOT_SUPPORTED' }, { reason: 'API_KEY_INVALID synthetic-private-error-key' },
    { reason: { value: 'API_KEY_INVALID' } },
  ])('keeps non-allowlisted Google 400 metadata as a normal model-options rejection: %j', async (info) => {
    const client = createGeminiClient('https://generativelanguage.googleapis.com', 'fixture-key', 1000,
      jest.fn().mockResolvedValue(new Response(JSON.stringify(googleError(info)), { status: 400 })));
    let failure: unknown;
    try { await client.models.list(); } catch (error) { failure = error; }
    expect(failure).not.toBeInstanceOf(AiError);
    const mapped = providerError(failure, new AbortController().signal, 'fixture');
    expect(mapped.getStatus()).toBe(400);
    expect(mapped.code).toBe(ErrorCode.AI_CAPABILITY_UNSUPPORTED);
    expect(JSON.stringify(failure)).not.toContain('synthetic-private-error-key');
  });

  it.each(['not-json synthetic-private-error-key', JSON.stringify({ error: { code: 400, details: null } }),
    JSON.stringify({ error: { ...googleError().error, code: 403 } })])('does not classify malformed or mismatched error envelopes as authentication failures', async (body) => {
    const client = createGeminiClient('https://generativelanguage.googleapis.com', 'fixture-key', 1000,
      jest.fn().mockResolvedValue(new Response(body, { status: 400 })));
    await expect(client.models.list()).rejects.toMatchObject({ status: 400, message: 'Gemini provider request failed' });
  });

  it('cancels an oversized error body and does not inspect auth metadata beyond 16 KiB', async () => {
    let cancelled = false;
    const body = JSON.stringify({ padding: 'x'.repeat(17000), ...googleError() });
    const bytes = new TextEncoder().encode(body);
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.subarray(0, 8192));
        controller.enqueue(bytes.subarray(8192, 16384));
        controller.enqueue(bytes.subarray(16384));
      },
      cancel() { cancelled = true; },
    }), { status: 400 });
    const client = createGeminiClient('https://generativelanguage.googleapis.com', 'fixture-key', 1000,
      jest.fn().mockResolvedValue(response));
    await expect(client.models.list()).rejects.toMatchObject({ status: 400, message: 'Gemini provider request failed' });
    expect(cancelled).toBe(true);
  });

  it('discovers models without consulting a saved model name or issuing generation requests', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response(JSON.stringify({ models: [{ name: 'models/fixture-model' }] })));
    const client = createGeminiClient('https://generativelanguage.googleapis.com', 'fixture-key', 1000, fetchImpl);
    const clients = { timeout: () => 1000, acquire: jest.fn().mockResolvedValue({ id: 'fixture-lease' }),
      gemini: jest.fn().mockResolvedValue(client), finish: jest.fn().mockResolvedValue(undefined) };
    const registry = new AiRegistryService({ aiProvider: { findUnique: jest.fn().mockResolvedValue({
      enabled: true, type: 'gemini', models: ['fixture-operator@school.local'],
    }) } } as never, clients as never, new ConfigService(), {} as never);
    await expect(registry.discover('gemini')).resolves.toMatchObject({ modelIds: ['fixture-model'] });
    expect(clients.acquire).toHaveBeenCalledWith('gemini', '', 'model-list', 0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe('https://generativelanguage.googleapis.com/v1beta/models?pageSize=100');
    expect(fetchImpl.mock.calls[0][1].method).toBe('GET');
  });

  it('preserves the auth classification when model discovery fails and releases its single lease', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response(JSON.stringify(googleError()), { status: 400 }));
    const client = createGeminiClient('https://generativelanguage.googleapis.com', 'fixture-key', 1000, fetchImpl);
    const lease = { id: 'fixture-lease' };
    const clients = { timeout: () => 1000, acquire: jest.fn().mockResolvedValue(lease),
      gemini: jest.fn().mockResolvedValue(client), finish: jest.fn().mockResolvedValue(undefined) };
    const registry = new AiRegistryService({ aiProvider: { findUnique: jest.fn().mockResolvedValue({
      enabled: true, type: 'gemini',
    }) } } as never, clients as never, new ConfigService(), {} as never);
    await expect(registry.discover('gemini')).rejects.toMatchObject({ code: ErrorCode.AI_PROVIDER_AUTH_FAILED });
    expect(clients.finish).toHaveBeenCalledWith(lease, null, expect.objectContaining({
      code: ErrorCode.AI_PROVIDER_AUTH_FAILED, upstreamStatus: 400, retryable: false,
    }));
    expect(clients.acquire).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
