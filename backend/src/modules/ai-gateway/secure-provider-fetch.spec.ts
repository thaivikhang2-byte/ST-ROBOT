import { approvedRequest, publicProviderAddress, ProviderTransport } from './secure-provider-fetch';
describe('Provider network boundary', () => {
  it.each(['127.0.0.1','10.2.3.4','169.254.169.254','172.18.0.2','192.168.1.2','100.64.1.1','::1','::ffff:127.0.0.1','fc00::1','fe80::1','2001:db8::1','2002:7f00:1::1','not-an-ip'])('denies nonpublic address %s', (ip) => expect(publicProviderAddress(ip)).toBe(false));
  it.each(['8.8.8.8','1.1.1.1','2606:4700:4700::1111'])('permits global address %s', (ip) => expect(publicProviderAddress(ip)).toBe(true));
  it.each(['https://evil.example/v1/chat/completions','http://api.openai.com/v1/responses','https://api.openai.com/v2/responses','https://api.openai.com/v1/%2fadmin','https://user:pass@api.openai.com/v1/responses'])('denies escaped origin/path %s', (url) => expect(() => approvedRequest('https://api.openai.com/v1',url)).toThrow());
  it('permits an official endpoint and rejects IP/configured credential-bearing bases', () => {
    expect(() => approvedRequest('https://api.openai.com/v1','https://api.openai.com/v1/responses')).not.toThrow();
    expect(() => approvedRequest('https://127.0.0.1/v1','https://127.0.0.1/v1/responses')).toThrow();
  });
  it('does not follow redirects or send a second authenticated request', async () => {
    const mock = jest.spyOn(globalThis,'fetch').mockResolvedValue(new Response(null,{status:302,headers:{location:'http://169.254.169.254/'}}));
    const transport = new ProviderTransport();
    try {
      await expect(transport.create('https://api.openai.com/v1')('https://api.openai.com/v1/responses')).rejects.toThrow('redirects');
      expect(mock).toHaveBeenCalledTimes(1);
      expect(mock.mock.calls[0][1]).toMatchObject({redirect:'manual'});
    } finally { mock.mockRestore(); await transport.onModuleDestroy(); }
  });
});
