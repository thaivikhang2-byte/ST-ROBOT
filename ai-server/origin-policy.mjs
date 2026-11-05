const defaultOrigin = 'https://thaivikhang2-byte.github.io';

// Browsers send an origin without a path or trailing slash. Accept a pasted
// website URL in deployment settings while keeping one exact allowed origin.
export function normalizeAllowedOrigin(value, fallback = defaultOrigin) {
  const selected = value === undefined || (typeof value === 'string' && !value.trim()) ? fallback : value;
  if (typeof selected !== 'string' || !selected.trim()) throw new Error('ALLOWED_ORIGIN must be an HTTP(S) website URL.');
  let url;
  try { url = new URL(selected.trim()); }
  catch { throw new Error('ALLOWED_ORIGIN must be an HTTP(S) website URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.origin === 'null' || url.hostname.includes('*') || url.username || url.password) {
    throw new Error('ALLOWED_ORIGIN must be an HTTP(S) website URL without credentials or wildcards.');
  }
  return url.origin;
}
