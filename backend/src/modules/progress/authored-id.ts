import { createHash } from 'node:crypto';

export const authoredCourseKeys = ['arduino', 'vex-iq', 'microbit', 'lego-spike', 'vex-vr'];
export function authoredId(key: string) {
  const hex = createHash('sha256').update(`strobot-authored-v1:${key}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
