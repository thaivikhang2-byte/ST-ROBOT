import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Agent } from 'undici';
import { lookup } from 'node:dns';
import { BlockList, isIP } from 'node:net';
import { AiError } from './ai.error';
import { ErrorCode } from '../../shared/sdk/errors/error-codes.enum';
import { traceHeaders } from '../../shared/sdk/logger/request-context';

const blocked = new BlockList();
for (const [address, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['100.64.0.0', 10],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(address, bits, 'ipv4');
for (const [address, bits] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['2001:db8::', 32],
  ['2001::', 23],
  ['2002::', 16],
] as const)
  blocked.addSubnet(address, bits, 'ipv6');
export function publicProviderAddress(address: string) {
  if (address.toLowerCase().startsWith('::ffff:')) return false;
  const family = isIP(address);
  const globalV6 = parseInt(address.split(':')[0], 16);
  return family === 4
    ? !blocked.check(address, 'ipv4')
    : family === 6
      ? globalV6 >= 0x2000 && globalV6 <= 0x3fff && !blocked.check(address, 'ipv6')
      : false;
}
export function approvedRequest(baseUrl: string, requestUrl: string) {
  const base = new URL(baseUrl),
    url = new URL(requestUrl);
  if (
    base.protocol !== 'https:' ||
    isIP(base.hostname.replace(/^\[|\]$/g, '')) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    (base.port && base.port !== '443') ||
    url.origin !== base.origin ||
    url.username ||
    url.password ||
    !url.pathname.startsWith(base.pathname.replace(/\/$/, '') + '/') ||
    /\.{2}|%2e|%2f|%5c/i.test(url.pathname)
  )
    throw new AiError(ErrorCode.FORBIDDEN, 403, 'Unapproved AI upstream request');
}
@Injectable()
export class ProviderTransport implements OnModuleDestroy {
  private readonly agent = new Agent({
    connect: {
      lookup: (hostname, options, callback) => {
        lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
          if (error) return callback(error, [], undefined);
          if (!addresses.length || addresses.some((a) => !publicProviderAddress(a.address)))
            return callback(new Error('AI upstream address denied'), [], undefined);
          // Resolve and validate on the actual connection, closing the DNS-rebinding gap.
          if (options.all) callback(null, addresses, undefined);
          else callback(null, addresses[0].address, addresses[0].family);
        });
      },
    },
    headersTimeout: 120000,
    bodyTimeout: 120000,
    connections: 16,
  });
  create(baseUrl: string): typeof fetch {
    return async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      approvedRequest(baseUrl, url);
      const options: RequestInit & { dispatcher: Agent } = {
        ...init,
        headers: (() => {
          const headers = new Headers(
            init?.headers ?? (input instanceof Request ? input.headers : undefined),
          );
          for (const [key, value] of Object.entries(traceHeaders())) headers.set(key, value);
          return headers;
        })(),
        redirect: 'manual',
        dispatcher: this.agent,
      };
      const response = await fetch(input, options);
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        throw new AiError(ErrorCode.AI_UPSTREAM_ERROR, 502, 'AI upstream redirects are forbidden');
      }
      return response;
    };
  }
  async onModuleDestroy() {
    await this.agent.close();
  }
}
