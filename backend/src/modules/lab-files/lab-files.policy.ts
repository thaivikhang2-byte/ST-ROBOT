import { BadRequestException } from '@nestjs/common';
import { courseLessons } from '../learner-state/learner-state.policy';
import { siteCourseLabs } from '../ai-gateway/agent/site-lab-catalog';

export const LAB_FILE_LIMITS = Object.freeze({
  fileBytes: 25 * 1024 * 1024,
  accountBytes: 250 * 1024 * 1024,
  filesPerLab: 50,
  filesPerAccount: 500,
  chunkBytes: 1024 * 1024,
});
export const LAB_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
export const LAB_CHUNK_ENCODED_LIMIT = Math.ceil(LAB_FILE_LIMITS.chunkBytes / 3) * 4;

export interface LabFileScope { courseId: string; lessonId: string; platformKey: string; }

export function validateLabFileScope(scope: LabFileScope) {
  if (!Object.hasOwn(courseLessons, scope.courseId)
      || !courseLessons[scope.courseId].includes(scope.lessonId)
      || !siteCourseLabs[scope.courseId]?.includes(scope.platformKey))
    throw new BadRequestException('Khóa học, bài học hoặc nền tảng lưu tệp không hợp lệ.');
}

export function validateLabFileName(name: string) {
  if (typeof name !== 'string' || !name.trim() || name.length > 180
      || /[\/\\\u0000-\u001f\u007f]/.test(name) || ['.', '..', '__proto__', 'prototype', 'constructor'].includes(name))
    throw new BadRequestException('Tên tệp cần có tối đa 180 ký tự và không chứa đường dẫn.');
}

export function decodeLabFileChunk(encoded: unknown): Buffer {
  if (typeof encoded !== 'string' || !encoded || encoded.length > LAB_CHUNK_ENCODED_LIMIT
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))
    throw new BadRequestException('Dữ liệu tệp tải lên không hợp lệ.');
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length > LAB_FILE_LIMITS.chunkBytes || bytes.toString('base64') !== encoded)
    throw new BadRequestException('Dữ liệu tệp tải lên không hợp lệ.');
  return bytes;
}
