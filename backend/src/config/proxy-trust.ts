import { isIP } from 'node:net';

/** Explicit proxy hops or trusted CIDRs; never enable blanket trust by typo. */
export function proxyTrust(value: string): number | string[] {
  const text = value.trim();
  if (/^\d+$/.test(text)) {
    const hops = Number(text);
    if (Number.isSafeInteger(hops) && hops <= 16) return hops;
    throw new Error('Invalid trusted proxy configuration');
  }
  const entries = text.split(',').map(x => x.trim());
  if (!entries.length || entries.some(entry => {
    if (['loopback', 'linklocal', 'uniquelocal'].includes(entry)) return false;
    const parts = entry.split('/');
    const version = isIP(parts[0]);
    if (!version || parts.length > 2) return true;
    return parts.length === 2 && (!/^\d+$/.test(parts[1]) || Number(parts[1]) > (version === 4 ? 32 : 128));
  })) throw new Error('Invalid trusted proxy configuration');
  return entries;
}
