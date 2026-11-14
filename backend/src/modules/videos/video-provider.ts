export type Rendition = { height: number; width: number; bandwidth: number; playlist: string };
export type CloudVideoState = {
  ready: boolean;
  failed: boolean;
  percent: number;
  duration: number;
  width: number;
  height: number;
};
// Application authorization always precedes invoking a provider.
export interface ManagedVideoProvider {
  createUpload(maxDuration: number): Promise<{ uid: string; url: string }>;
  status(uid: string): Promise<CloudVideoState>;
  playback(uid: string, expires: number): Promise<string>;
  deleteVideo(uid: string): Promise<void>;
}
export function safeHlsFile(name: string) {
  return /^(?:master\.m3u8|\d+p\.m3u8|\d+p-\d{5}\.ts|thumbnail\.jpg)$/.test(name);
}
export function ladder(width: number, height: number): Rendition[] {
  const heights = [360, 720, 1080].filter((h) => h <= height);
  if (!heights.length) heights.push(Math.max(2, Math.floor(height / 2) * 2));
  return heights.map((h) => ({
    height: h,
    width: Math.max(2, Math.floor((width * h) / height / 2) * 2),
    bandwidth: h <= 360 ? 900000 : h <= 720 ? 2800000 : 5000000,
    playlist: `${h}p.m3u8`,
  }));
}
