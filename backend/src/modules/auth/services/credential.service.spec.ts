import { CredentialService } from './credential.service';
import { PrismaService } from '../../../database/prisma.service';
import { MailService } from '../../mail/mail.service';
import { Queue } from 'bull';
describe('Account enumeration boundary', () => {
  it('enqueues every address without account lookup or raw tokens', async () => {
    const add = jest
      .fn<Promise<object>, [string, { email: string; purpose: string }, object]>()
      .mockResolvedValue({});
    const mail = { assertConfigured: jest.fn() } as unknown as MailService;
    const service = new CredentialService({} as PrismaService, mail, { add } as unknown as Queue);
    await service.request(' Known@Example.com ', 'reset');
    await service.request('missing@example.com', 'reset');
    expect(add.mock.calls[0][1]).toEqual({ email: 'known@example.com', purpose: 'reset' });
    expect(add.mock.calls[1][1]).toEqual({ email: 'missing@example.com', purpose: 'reset' });
    expect(add.mock.calls.every((call) => !('token' in call[1]))).toBe(true);
  });
  it('fails safely on queue outage without returning provider details', async () => {
    const mail = { assertConfigured: jest.fn() } as unknown as MailService;
    const queue = {
      add: jest.fn().mockRejectedValue(new Error('private redis config')),
    } as unknown as Queue;
    const service = new CredentialService({} as PrismaService, mail, queue);
    await expect(service.request('user@example.com', 'verify')).rejects.toMatchObject({
      message: 'Email delivery unavailable',
    });
  });
});
