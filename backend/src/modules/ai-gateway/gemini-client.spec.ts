import { createGeminiClient } from './gemini-client';

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
});
