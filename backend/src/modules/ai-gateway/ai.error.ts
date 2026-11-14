import { HttpStatus } from '@nestjs/common';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { BaseException } from '../../shared/sdk/errors/base.exception';
import { ErrorCode } from '../../shared/sdk/errors/error-codes.enum';

export class AiError extends BaseException {
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  readonly upstreamStatus?: number;
  constructor(
    code: ErrorCode,
    status: HttpStatus,
    message: string,
    requestId?: string,
    options?: { retryable?: boolean; retryAfterMs?: number; upstreamStatus?: number },
  ) {
    super(message, code, status, requestId ? { requestId } : undefined);
    this.retryable = options?.retryable ?? false;
    this.retryAfterMs = options?.retryAfterMs;
    this.upstreamStatus = options?.upstreamStatus;
  }
}

export function parseRetryAfterMs(headers?: Headers | Record<string, string | null | undefined> | null): number | undefined {
  if (!headers) return undefined;
  const raw =
    typeof (headers as Headers).get === 'function'
      ? (headers as Headers).get('retry-after') ?? (headers as Headers).get('x-ratelimit-reset-requests')
      : (headers as Record<string, string | null | undefined>)['retry-after'] ??
        (headers as Record<string, string | null | undefined>)['Retry-After'];
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (Number.isFinite(seconds) && seconds >= 0 && seconds <= 300) {
      return Math.round(seconds * 1000);
    }
  }
  const dateMs = Date.parse(trimmed);
  if (Number.isFinite(dateMs)) {
    const delta = dateMs - Date.now();
    if (delta >= 0 && delta <= 300000) return delta;
  }
  return undefined;
}

export function providerError(error: unknown, signal: AbortSignal, requestId: string): AiError {
  if (error instanceof AiError) return error;
  if (
    error instanceof OpenAI.APIConnectionTimeoutError ||
    error instanceof Anthropic.APIConnectionTimeoutError ||
    (error instanceof Error && error.name === 'TimeoutError')
  )
    return new AiError(ErrorCode.AI_TIMEOUT, 504, 'AI provider timed out', requestId, {
      retryable: false,
      upstreamStatus: 408,
    });
  if (signal.aborted)
    return new AiError(
      signal.reason === 'timeout' ? ErrorCode.AI_TIMEOUT : ErrorCode.AI_CANCELLED,
      504,
      'AI request interrupted',
      requestId,
      { retryable: false },
    );
  const status =
    error instanceof OpenAI.APIError || error instanceof Anthropic.APIError
      ? error.status
      : typeof error === 'object' && error !== null && 'status' in error && typeof (error as { status: unknown }).status === 'number'
        ? (error as { status: number }).status
        : undefined;
  const headers =
    error instanceof OpenAI.APIError || error instanceof Anthropic.APIError
      ? (error.headers as Headers | undefined)
      : typeof error === 'object' && error !== null && 'headers' in error
        ? ((error as { headers?: Headers | Record<string, string> }).headers)
        : undefined;
  const retryAfterMs = parseRetryAfterMs(headers);

  if (status !== undefined) {
    if (status === 408)
      return new AiError(ErrorCode.AI_TIMEOUT, 504, 'AI provider request timed out', requestId, {
        retryable: retryAfterMs !== undefined,
        retryAfterMs,
        upstreamStatus: 408,
      });
    if (status === 429)
      return new AiError(
        ErrorCode.AI_UPSTREAM_RATE_LIMIT,
        429,
        'AI provider rate limit reached',
        requestId,
        { retryable: retryAfterMs !== undefined, retryAfterMs, upstreamStatus: 429 },
      );
    if (status === 402)
      return new AiError(
        ErrorCode.AI_PAYMENT_REQUIRED,
        402,
        'AI provider quota or payment limit reached',
        requestId,
        { retryable: false, upstreamStatus: 402 },
      );
    if (status === 401 || status === 403)
      return new AiError(
        ErrorCode.AI_PROVIDER_UNAVAILABLE,
        503,
        'AI provider configuration is unavailable',
        requestId,
        { retryable: false, upstreamStatus: status },
      );
    if (status === 400 || status === 422)
      return new AiError(
        ErrorCode.AI_CAPABILITY_UNSUPPORTED,
        400,
        'Provider rejected the selected model options',
        requestId,
        { retryable: false, upstreamStatus: status },
      );
    if (status === 503)
      return new AiError(
        ErrorCode.AI_PROVIDER_UNAVAILABLE,
        503,
        'AI provider temporarily unavailable (HTTP 503)',
        requestId,
        { retryable: true, retryAfterMs, upstreamStatus: 503 },
      );
    if (status === 500 || status === 502 || status === 504 || status >= 500)
      return new AiError(
        ErrorCode.AI_UPSTREAM_ERROR,
        502,
        'AI provider transient failure',
        requestId,
        { retryable: true, retryAfterMs, upstreamStatus: status },
      );
  }
  if (error instanceof Error && /content_filter|moderation|safety/i.test(error.message)) {
    return new AiError(
      ErrorCode.AI_CONTENT_FILTERED,
      422,
      'AI response was blocked by provider content filter',
      requestId,
      { retryable: false },
    );
  }
  // Upstream bodies and messages may contain prompts, credentials or internal URLs.
  return new AiError(ErrorCode.AI_UPSTREAM_ERROR, 502, 'AI provider request failed', requestId, {
    retryable: false,
  });
}
