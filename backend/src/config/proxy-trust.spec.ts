import express from 'express';
import { proxyTrust } from './proxy-trust';

describe('Managed reverse-proxy trust', () => {
  it('interprets the Render value 1 as one trusted hop, not an IP address string', () => {
    const server = express();
    server.set('trust proxy', proxyTrust('1'));
    const trust = server.get('trust proxy fn') as (address: string, hop: number) => boolean;
    expect(trust('203.0.113.20', 0)).toBe(true);
    expect(trust('203.0.113.20', 1)).toBe(false);
  });
  it('preserves explicit proxy CIDRs and does not trust unrelated senders', () => {
    const server = express();
    server.set('trust proxy', proxyTrust('127.0.0.1, 192.0.2.0/24'));
    const trust = server.get('trust proxy fn') as (address: string, hop: number) => boolean;
    expect(trust('127.0.0.1', 0)).toBe(true);
    expect(trust('192.0.2.8', 0)).toBe(true);
    expect(trust('203.0.113.8', 0)).toBe(false);
  });
  it.each(['true', '*', 'all', '17', '192.0.2.0/33', 'loopback,', 'example.com'])
  ('rejects invalid or blanket trust: %s', value => {
    expect(() => proxyTrust(value)).toThrow('Invalid trusted proxy configuration');
  });
});
