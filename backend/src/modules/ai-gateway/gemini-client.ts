import type { Content, GenerateContentResponse, EmbedContentResponse } from '@google/genai';

interface GenerateParams {
  model: string;
  contents: Content[];
  config: {
    abortSignal?: AbortSignal;
    maxOutputTokens?: number;
    systemInstruction?: string;
    temperature?: number;
    tools?: unknown[];
    responseMimeType?: string;
    responseJsonSchema?: unknown;
  };
}

const RESPONSE_BYTES = 4 * 1024 * 1024;

async function jsonResponse(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Gemini returned an empty response');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > RESPONSE_BYTES) throw new Error('Gemini response exceeds limit');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

async function* sseResponses(response: Response): AsyncGenerator<GenerateContentResponse> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Gemini returned an empty stream');
  const decoder = new TextDecoder();
  let buffer = '', size = 0;
  const parse = (event: string): GenerateContentResponse | undefined => {
    const data = event.split('\n').filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim()).join('\n');
    if (!data || data === '[DONE]') return undefined;
    return JSON.parse(data) as GenerateContentResponse;
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > RESPONSE_BYTES) throw new Error('Gemini stream exceeds limit');
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const event = parse(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        if (event) yield event;
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      const event = parse(buffer);
      if (event) yield event;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Gemini's SDK HttpOptions has no custom fetch hook. Use the pinned transport
 * directly instead of silently bypassing host/redirect/DNS/retry controls. */
export function createGeminiClient(baseUrl: string, apiKey: string, timeoutMs: number, fetchImpl: typeof fetch) {
  const base = baseUrl.replace(/\/$/, '').replace(/\/v1beta$/, '');
  const modelName = (model: string) => {
    const name = model.replace(/^models\//, '');
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.@-]{0,199}$/.test(name)) throw new Error('Invalid Gemini model ID');
    return `models/${name}`;
  };
  const request = async (path: string, body?: unknown, signal?: AbortSignal) => {
    const timeout = AbortSignal.timeout(timeoutMs);
    const response = await fetchImpl(`${base}/v1beta/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      // Do not retain upstream bodies, which can contain private request content.
      throw Object.assign(new Error('Gemini provider request failed'), { status: response.status, headers: response.headers });
    }
    return response;
  };
  const generationBody = ({ contents, config }: GenerateParams) => ({
    contents,
    ...(config.systemInstruction ? { systemInstruction: { parts: [{ text: config.systemInstruction }] } } : {}),
    ...(config.tools?.length ? { tools: config.tools } : {}),
    generationConfig: {
      ...(config.maxOutputTokens === undefined ? {} : { maxOutputTokens: config.maxOutputTokens }),
      ...(config.temperature === undefined ? {} : { temperature: config.temperature }),
      ...(config.responseMimeType ? { responseMimeType: config.responseMimeType } : {}),
      ...(config.responseJsonSchema ? { responseJsonSchema: config.responseJsonSchema } : {}),
    },
  });
  return {
    models: {
      generateContent: async (params: GenerateParams): Promise<GenerateContentResponse> =>
        await jsonResponse(await request(`${modelName(params.model)}:generateContent`, generationBody(params), params.config.abortSignal)) as GenerateContentResponse,
      generateContentStream: async (params: GenerateParams): Promise<AsyncGenerator<GenerateContentResponse>> =>
        sseResponses(await request(`${modelName(params.model)}:streamGenerateContent?alt=sse`, generationBody(params), params.config.abortSignal)),
      embedContent: async (params: { model: string; contents: string[]; config?: { abortSignal?: AbortSignal } }): Promise<EmbedContentResponse> => {
        const model = modelName(params.model);
        return await jsonResponse(await request(`${model}:batchEmbedContents`, {
          requests: params.contents.map((text) => ({ model, content: { parts: [{ text }] } })),
        }, params.config?.abortSignal)) as EmbedContentResponse;
      },
      list: async ({ config }: { config?: { pageSize?: number } } = {}): Promise<AsyncGenerator<{ name?: string }>> => {
        const pageSize = Math.min(Math.max(config?.pageSize ?? 100, 1), 100);
        const data = await jsonResponse(await request(`models?pageSize=${pageSize}`)) as { models?: Array<{ name?: string }> };
        return (async function* () { for (const model of (data.models ?? []).slice(0, pageSize)) yield model; })();
      },
    },
  };
}
