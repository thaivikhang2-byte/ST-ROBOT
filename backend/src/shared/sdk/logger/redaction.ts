const privateKey =
  /password|authorization|cookie|secret|api.?key|credential|prompt|conversation|email|stack|body|query|headers|ciphertext|authTag|^iv$|refresh.?token|access.?token/i;
export function redact<T>(value: T, secrets: string[] = [], depth = 0): T {
  if (depth > 6) return '[TRUNCATED]' as T;
  if (typeof value === 'string') {
    let text: string = value;
    for (const secret of secrets)
      if (secret.length >= 8) text = text.split(secret).join('[REDACTED]');
    text = text
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED]')
      .replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|AIza[A-Za-z0-9_-]{20,}|[a-f0-9]{64})\b/gi, '[REDACTED]')
      .replace(/(?:postgres(?:ql)?|rediss?):\/\/[^\s]+/gi, '[REDACTED]')
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED]')
      .replace(
        /(password|secret|api[_-]?key|refresh[_-]?token)\s*[:=]\s*[^,\s}]+/gi,
        '$1=[REDACTED]',
      );
    return text.slice(0, 2048) as T;
  }
  if (Array.isArray(value))
    return (value as unknown[]).slice(0, 20).map((item) => redact(item, secrets, depth + 1)) as T;
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        privateKey.test(key) ? '[REDACTED]' : redact(item, secrets, depth + 1),
      ]),
    ) as T;
  return value;
}
