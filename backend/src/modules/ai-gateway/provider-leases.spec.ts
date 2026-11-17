import { ProviderLeases, type ProviderLease } from './provider-leases';
import { AiError } from './ai.error';
import { ErrorCode } from '../../shared/sdk/errors/error-codes.enum';

describe('Provider credential authentication cooldown', () => {
  const lease = { id: 'fixture-lease', provider: { id: 'fixture-provider' }, reserved: 0,
    keys: ['account-minute', 'account-day', 'account-active', 'credential-minute', 'credential-day',
      'credential-active', 'account-cooldown', 'credential-cooldown', 'endpoint-cooldown', 'lease-key'],
  } as unknown as ProviderLease;

  function setup() {
    const client = { eval: jest.fn().mockResolvedValue(1), set: jest.fn().mockResolvedValue('OK') };
    return { client, service: new ProviderLeases({} as never,
      { getClient: () => client } as never) };
  }

  it.each([
    { status: 401 }, { status: 403 },
    new AiError(ErrorCode.AI_PROVIDER_AUTH_FAILED, 503, 'Credentials rejected', undefined,
      { retryable: false, upstreamStatus: 400 }),
  ])('temporarily cools only the rejected credential while preserving release accounting', async (error) => {
    const { client, service } = setup();
    await service.finish(lease, null, error);
    expect(client.eval).toHaveBeenCalledWith(expect.any(String), lease.keys.length,
      ...lease.keys, lease.id, 0);
    expect(client.set).toHaveBeenCalledTimes(1);
    expect(client.set).toHaveBeenCalledWith('credential-cooldown', '1', 'EX', 300);
  });

  it('does not cool down a credential for an ordinary model-options 400', async () => {
    const { client, service } = setup();
    await service.finish(lease, null, { status: 400 });
    expect(client.eval).toHaveBeenCalledTimes(1);
    expect(client.set).not.toHaveBeenCalled();
  });

  it.each([[429, 'account-cooldown', 60], [503, 'endpoint-cooldown', 30]] as const)
  ('retains the existing upstream %i cooldown scope', async (status, key, seconds) => {
    const { client, service } = setup();
    await service.finish(lease, null, { status });
    expect(client.set).toHaveBeenCalledTimes(1);
    expect(client.set).toHaveBeenCalledWith(key, '1', 'EX', seconds);
  });
});
