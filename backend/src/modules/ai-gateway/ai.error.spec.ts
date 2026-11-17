import { providerError } from './ai.error';
import { ErrorCode } from '../../shared/sdk/errors/error-codes.enum';

describe('Safe provider authentication classification', () => {
  it.each([401, 403])('classifies upstream %i without exposing its message', (status) => {
    const mapped = providerError({ status, message: 'fixture-private-provider-secret' },
      new AbortController().signal, 'fixture-request');
    expect(mapped.code).toBe(ErrorCode.AI_PROVIDER_AUTH_FAILED);
    expect(mapped.getStatus()).toBe(503);
    expect(mapped.retryable).toBe(false);
    expect(mapped.upstreamStatus).toBe(status);
    expect(JSON.stringify(mapped)).not.toContain('fixture-private-provider-secret');
  });

  it.each([400, 422])('keeps ordinary upstream %i as a model-options rejection', (status) => {
    const mapped = providerError({ status, message: 'fixture-private-provider-secret' },
      new AbortController().signal, 'fixture-request');
    expect(mapped.code).toBe(ErrorCode.AI_CAPABILITY_UNSUPPORTED);
    expect(mapped.getStatus()).toBe(400);
    expect(mapped.retryable).toBe(false);
    expect(JSON.stringify(mapped)).not.toContain('fixture-private-provider-secret');
  });
});
