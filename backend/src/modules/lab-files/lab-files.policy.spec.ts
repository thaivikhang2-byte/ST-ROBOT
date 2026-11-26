import { BadRequestException } from '@nestjs/common';
import { decodeLabFileChunk, LAB_FILE_LIMITS, validateLabFileName, validateLabFileScope } from './lab-files.policy';

describe('Private lab file input policy', () => {
  it.each(['ảnh thí nghiệm.jpg', 'ảnh.png', 'report.pdf', 'notes.docx', 'project.sb3', 'a..b', 'README', 'program.exe', 'page.html'])
  ('accepts an opaque attachment named %s without extension restrictions', name => {
    expect(() => validateLabFileName(name)).not.toThrow();
  });

  it.each(['', '   ', '.', '..', '../secret', 'a/b.png', 'a\\b.png', 'a\0.png', 'a\n.png', '__proto__', 'a'.repeat(181)])
  ('refuses a missing, ambiguous or non-basename attachment name %j', name => {
    expect(() => validateLabFileName(name)).toThrow(BadRequestException);
  });

  it('uses the approved course, lesson and platform together', () => {
    expect(() => validateLabFileScope({ courseId: 'arduino', lessonId: 'led', platformKey: 'phet' })).not.toThrow();
    expect(() => validateLabFileScope({ courseId: 'microbit', lessonId: 'matrix', platformKey: 'local' })).not.toThrow();
    for (const scope of [
      { courseId: '__proto__', lessonId: 'led', platformKey: 'local' },
      { courseId: 'arduino', lessonId: 'matrix', platformKey: 'local' },
      { courseId: 'microbit', lessonId: 'matrix', platformKey: 'wokwi' },
      { courseId: 'microbit', lessonId: 'matrix', platformKey: 'scratch' },
      { courseId: 'arduino', lessonId: 'led', platformKey: 'unknown' },
    ]) expect(() => validateLabFileScope(scope)).toThrow(BadRequestException);
  });

  it('accepts exact 1 MiB binary chunks without changing their bytes', () => {
    const bytes = Buffer.alloc(LAB_FILE_LIMITS.chunkBytes);
    for (let index = 0; index < bytes.length; index++) bytes[index] = index % 256;
    expect(decodeLabFileChunk(bytes.toString('base64'))).toEqual(bytes);
  });

  it.each([null, 12, '', '!', 'Zg==\n', 'Zh==', 'Zg', 'Z===', '====', 'AAAA='])
  ('rejects malformed or noncanonical chunk payload %j', value => {
    expect(() => decodeLabFileChunk(value)).toThrow(BadRequestException);
  });

  it('rejects a decoded chunk larger than 1 MiB', () => {
    expect(() => decodeLabFileChunk(Buffer.alloc(LAB_FILE_LIMITS.chunkBytes + 1).toString('base64')))
      .toThrow(BadRequestException);
  });
});
