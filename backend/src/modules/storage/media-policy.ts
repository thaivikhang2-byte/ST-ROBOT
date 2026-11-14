import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import { TextDecoder } from 'node:util';
import { DomainException } from '../../shared/sdk/errors/domain.exception';
import { ErrorCode } from '../../shared/sdk/errors/error-codes.enum';

const types: Record<string, { extensions: string[]; resource: string }> = {
  'application/pdf': { extensions: ['.pdf'], resource: 'document' },
  'image/png': { extensions: ['.png'], resource: 'image' },
  'image/jpeg': { extensions: ['.jpg', '.jpeg'], resource: 'image' },
  'image/webp': { extensions: ['.webp'], resource: 'image' },
  'video/mp4': { extensions: ['.mp4'], resource: 'video' },
  'text/plain': { extensions: ['.txt'], resource: 'download' },
  'text/csv': { extensions: ['.csv'], resource: 'download' },
};
export function invalidMedia(message: string) {
  return new DomainException(message, ErrorCode.VALIDATION_ERROR);
}
export function mediaType(filename: string, mime: string) {
  const type = types[mime];
  if (
    !type ||
    !type.extensions.includes(extname(filename).toLowerCase()) ||
    [...filename].some(
      (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 || '/\\:'.includes(c),
    ) ||
    filename.includes('..') ||
    !filename.trim()
  )
    throw invalidMedia('Unsupported filename, extension or MIME type');
  return type.resource;
}
export function mediaLimit(mime: string, configuredMax: number) {
  const limit = mime.startsWith('text/')
    ? 1048576
    : mime.startsWith('image/')
      ? 10485760
      : mime === 'application/pdf'
        ? 26214400
        : 104857600;
  return Math.min(limit, configuredMax);
}
export function verifyMedia(data: Buffer, mime: string, size: number, checksum: string) {
  if (data.length !== size || createHash('sha256').update(data).digest('hex') !== checksum)
    throw invalidMedia('Uploaded content does not match declared size or checksum');
  let valid = false;
  if (mime === 'application/pdf') valid = data.subarray(0, 5).toString('ascii') === '%PDF-';
  if (mime === 'image/png')
    valid = data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  if (mime === 'image/jpeg') valid = data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  if (mime === 'image/webp')
    valid = data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP';
  if (mime === 'video/mp4')
    valid =
      data.length >= 24 &&
      data.subarray(4, 8).toString() === 'ftyp' &&
      ['isom', 'iso2', 'mp41', 'mp42', 'avc1', 'M4V '].includes(data.subarray(8, 12).toString());
  if (mime === 'text/plain' || mime === 'text/csv') {
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(data);
      valid = data.length <= mediaLimit(mime, 104857600);
      for (const c of text) {
        const code = c.charCodeAt(0);
        if ((code < 32 && ![9, 10, 13].includes(code)) || code === 127) {
          valid = false;
          break;
        }
      }
    } catch {
      valid = false;
    }
  }
  if (!valid) throw invalidMedia('File signature does not match the allowed type');
}
