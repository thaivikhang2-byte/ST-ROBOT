import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
const MAGIC = Buffer.from('STRB12\n');
export function backupKey(value: string) {
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32 || key.toString('base64') !== value)
    throw new Error('Backup requires an independent base64-encoded 32-byte key');
  return key;
}
export async function encryptStream(source: Readable, path: string, key: Buffer, maxBytes: number) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key, iv);
  let bytes = 0;
  const plainHash = createHash('sha256');
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      plainHash.update(chunk);
      callback(bytes > maxBytes ? new Error('Backup size limit exceeded') : null, chunk);
    },
  });
  const out = createWriteStream(path, { flags: 'wx', mode: 0o600 });
  out.write(Buffer.concat([MAGIC, iv]));
  await pipeline(source, limit, cipher, out, { end: false });
  out.end(cipher.getAuthTag());
  await new Promise<void>((resolve, reject) => {
    out.once('finish', resolve);
    out.once('error', reject);
  });
  const hash = createHash('sha256');
  for await (const data of createReadStream(path)) hash.update(data as Buffer);
  return {
    bytes,
    plainSha256: plainHash.digest('hex'),
    encryptedBytes: (await stat(path)).size,
    sha256: hash.digest('hex'),
  };
}
export async function decryptStream(path: string, key: Buffer): Promise<Readable> {
  const info = await stat(path);
  if (info.size < 35) throw new Error('Invalid encrypted backup');
  const file = await open(path, 'r');
  let header: Buffer, tag: Buffer;
  try {
    header = Buffer.alloc(19);
    tag = Buffer.alloc(16);
    await file.read(header, 0, 19, 0);
    await file.read(tag, 0, 16, info.size - 16);
  } finally {
    await file.close();
  }
  if (!header.subarray(0, 7).equals(MAGIC)) throw new Error('Invalid backup format');
  const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(7));
  decipher.setAuthTag(tag);
  const source = createReadStream(path, { start: 19, end: info.size - 17 });
  source.on('error', (e) => decipher.destroy(e));
  source.pipe(decipher);
  return decipher;
}
export async function verifyEncrypted(path: string, key: Buffer, sha256?: string) {
  if (sha256) {
    const hash = createHash('sha256');
    for await (const data of createReadStream(path)) hash.update(data as Buffer);
    if (hash.digest('hex') !== sha256) throw new Error('Backup checksum mismatch');
  }
  let bytes = 0;
  for await (const chunk of await decryptStream(path, key)) bytes += (chunk as Buffer).length;
  return bytes;
}
