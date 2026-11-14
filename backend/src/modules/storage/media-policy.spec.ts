import { createHash } from 'node:crypto';
import { mediaType, mediaLimit, verifyMedia } from './media-policy';
const check = (bytes: Buffer, mime: string) =>
  verifyMedia(bytes, mime, bytes.length, createHash('sha256').update(bytes).digest('hex'));
describe('Media trust boundary', () => {
  it('bounds text, images, PDFs and video independently of the global ceiling', () => {
    expect(mediaLimit('text/plain', 104857600)).toBe(1048576);
    expect(mediaLimit('image/png', 104857600)).toBe(10485760);
    expect(mediaLimit('application/pdf', 104857600)).toBe(26214400);
    expect(mediaLimit('video/mp4', 104857600)).toBe(104857600);
    expect(mediaLimit('video/mp4', 123)).toBe(123);
  });
  it.each([
    '../a.pdf',
    'folder/a.pdf',
    'a\\b.pdf',
    'a.exe',
    'a.svg',
    'a\n.pdf',
    'a:pdf.pdf',
    'a..pdf',
  ])('rejects unsafe filenames %s', (name) => {
    expect(() => mediaType(name, 'application/pdf')).toThrow();
  });
  it('accepts explicit educational MIME/extension pairs only', () => {
    expect(mediaType('tài-liệu.PDF', 'application/pdf')).toBe('document');
    expect(mediaType('pins.csv', 'text/csv')).toBe('download');
    expect(() => mediaType('file.png', 'application/pdf')).toThrow();
    expect(() => mediaType('script.js', 'application/javascript')).toThrow();
  });
  it('checks SHA-256 and size independently of extension', () => {
    const pdf = Buffer.from('%PDF-1.7\nexample');
    expect(() => check(pdf, 'application/pdf')).not.toThrow();
    expect(() => verifyMedia(pdf, 'application/pdf', pdf.length + 1, '0'.repeat(64))).toThrow();
    expect(() => verifyMedia(pdf, 'application/pdf', pdf.length, '0'.repeat(64))).toThrow();
  });
  it.each(['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'video/mp4'])(
    'rejects spoofed %s bytes',
    (mime) => {
      expect(() => check(Buffer.from('<script>alert(1)</script>'), mime)).toThrow();
    },
  );
  it('accepts UTF-8 text but rejects binary and malformed UTF-8', () => {
    expect(() => check(Buffer.from('Bài học\nLED,13\n'), 'text/csv')).not.toThrow();
    expect(() => check(Buffer.from([0, 1, 2]), 'text/plain')).toThrow();
    expect(() => check(Buffer.from([0xff]), 'text/plain')).toThrow();
  });
});
