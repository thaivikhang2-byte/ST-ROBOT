import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface EncryptedCredential {
  version: 1;
  algorithm: 'aes-256-gcm';
  keyId: string;
  iv: string;
  authTag: string;
  ciphertext: string;
}
export function masterKey(encoded: string): Buffer {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(encoded)) throw new Error('Invalid AI vault master key');
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encoded)
    throw new Error('Invalid AI vault master key');
  return key;
}
export function encryptCredential(
  plaintext: Buffer,
  key: Buffer,
  keyId: string,
  aad: string,
): EncryptedCredential {
  if (key.length !== 32 || !plaintext.length || plaintext.length > 4096)
    throw new Error('Invalid AI credential material');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    version: 1,
    algorithm: 'aes-256-gcm',
    keyId,
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}
export function decryptCredential(
  envelope: EncryptedCredential,
  key: Buffer,
  keyId: string,
  aad: string,
): Buffer {
  if (
    envelope.version !== 1 ||
    envelope.algorithm !== 'aes-256-gcm' ||
    envelope.keyId !== keyId ||
    key.length !== 32
  )
    throw new Error('Invalid AI credential envelope');
  const decode = (value: string, length?: number) => {
    if (typeof value !== 'string' || !value.length || !/^[A-Za-z0-9+/]*={0,2}$/.test(value))
      throw new Error('Invalid AI credential envelope');
    const bytes = Buffer.from(value, 'base64');
    if (bytes.toString('base64') !== value || (length && bytes.length !== length))
      throw new Error('Invalid AI credential envelope');
    return bytes;
  };
  const iv = decode(envelope.iv, 12),
    tag = decode(envelope.authTag, 16),
    ciphertext = decode(envelope.ciphertext);
  if (!ciphertext.length || ciphertext.length > 4096)
    throw new Error('Invalid AI credential envelope');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
