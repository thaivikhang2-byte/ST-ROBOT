import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, readdir, stat, rm, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { videoConfig } from '../../config/configurations';
import { StorageService } from '../storage/storage.service';
import { ladder, Rendition, safeHlsFile } from './video-provider';

export class VideoProcessingError extends Error {}
type Probe = {
  streams?: { codec_type: string; width?: number; height?: number }[];
  format?: { duration?: string };
};
@Injectable()
export class SelfHostedHlsProvider implements OnModuleDestroy {
  private readonly active = new Set<AbortController>();
  constructor(
    @Inject(videoConfig.KEY) readonly settings: ConfigType<typeof videoConfig>,
    private readonly storage: StorageService,
  ) {}
  async run(
    binary: string,
    args: string[],
    signal?: AbortSignal,
    timeout = this.settings.timeout * 1000,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const process = spawn(binary, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
      });
      let stdout = '',
        overflow = false;
      const stop = () => process.kill('SIGKILL');
      const timer = setTimeout(stop, timeout);
      signal?.addEventListener('abort', stop, { once: true });
      process.stdout.on('data', (c: Buffer) => {
        stdout += c.toString();
        if (stdout.length > 1024 * 1024) {
          overflow = true;
          stop();
        }
      });
      // Drain, but never expose file paths, media contents or FFmpeg diagnostic strings to clients.
      process.stderr.resume();
      process.on('error', () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', stop);
        reject(new VideoProcessingError('TOOL_UNAVAILABLE'));
      });
      process.on('close', (code) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', stop);
        if (code !== 0 || overflow || signal?.aborted)
          reject(new VideoProcessingError('ENCODING_FAILED'));
        else resolve(stdout);
      });
      if (signal?.aborted) stop();
    });
  }
  async validateOutput(directory: string, renditions: Rendition[]) {
    const names = await readdir(directory);
    if (names.length > 15000 || names.some((n) => !safeHlsFile(n)))
      throw new VideoProcessingError('INVALID_MANIFEST');
    const master = await readFile(join(directory, 'master.m3u8'), 'utf8');
    if (
      !master.startsWith('#EXTM3U\n') ||
      renditions.some((r) => !master.includes('\n' + r.playlist + '\n'))
    )
      throw new VideoProcessingError('INVALID_MANIFEST');
    for (const r of renditions) {
      const playlist = await readFile(join(directory, r.playlist), 'utf8');
      const segments = playlist.split(/\r?\n/).filter((x) => x && !x.startsWith('#'));
      if (
        !playlist.includes('#EXT-X-ENDLIST') ||
        !segments.length ||
        !playlist.includes('#EXT-X-INDEPENDENT-SEGMENTS')
      )
        throw new VideoProcessingError('INVALID_MANIFEST');
      for (const name of segments) {
        if (
          !safeHlsFile(name) ||
          !name.startsWith(r.height + 'p-') ||
          !name.endsWith('.ts') ||
          !names.includes(name) ||
          (await stat(join(directory, name))).size === 0
        )
          throw new VideoProcessingError('MISSING_SEGMENT');
      }
    }
    return names;
  }
  async process(
    source: { key: string; archiveKey: string; size: number; checksum: string; mimeType: string },
    prefix: string,
    onProgress: (percent: number) => Promise<boolean>,
  ) {
    const directory = await mkdtemp(join(tmpdir(), 'st-robot-video-'));
    const sourceFile = join(directory, 'source.mp4');
    const output = join(directory, 'hls');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(output);
    const abort = new AbortController();
    this.active.add(abort);
    const deadline = setTimeout(() => abort.abort(), this.settings.timeout * 1000);
    let percent = 5;
    const heartbeat = setInterval(() => {
      void onProgress(percent)
        .then((alive) => {
          if (!alive) abort.abort();
        })
        .catch(() => abort.abort());
    }, 5000);
    const uploaded: string[] = [];
    try {
      const checksum = await this.storage.downloadToFile(source.key, sourceFile, source.size);
      if (checksum !== source.checksum) throw new VideoProcessingError('CHECKSUM_MISMATCH');
      const file = await open(sourceFile, 'r');
      const header = Buffer.alloc(12);
      try {
        await file.read(header, 0, 12, 0);
      } finally {
        await file.close();
      }
      if (header.toString('ascii', 4, 8) !== 'ftyp')
        throw new VideoProcessingError('INVALID_CONTAINER');
      if (!(await this.storage.exists(source.archiveKey)))
        await this.storage.uploadFile(source.archiveKey, sourceFile, source.mimeType);
      const probe = JSON.parse(
        await this.run(
          this.settings.ffprobe,
          [
            '-v',
            'error',
            '-protocol_whitelist',
            'file,pipe',
            '-show_streams',
            '-show_format',
            '-of',
            'json',
            sourceFile,
          ],
          abort.signal,
          30000,
        ),
      ) as Probe;
      const track = probe.streams?.find((s) => s.codec_type === 'video');
      const width = track?.width || 0,
        height = track?.height || 0,
        duration = Number(probe.format?.duration);
      if (
        width < 2 ||
        height < 2 ||
        width > 4096 ||
        height > 4096 ||
        !Number.isFinite(duration) ||
        duration <= 0 ||
        duration > this.settings.maxDuration
      )
        throw new VideoProcessingError('INVALID_VIDEO_METADATA');
      const renditions = ladder(width, height);
      for (const [index, r] of renditions.entries()) {
        percent = 10 + Math.floor((index / renditions.length) * 70);
        if (!(await onProgress(percent))) throw new VideoProcessingError('CANCELLED');
        await this.run(
          this.settings.ffmpeg,
          [
            '-hide_banner',
            '-loglevel',
            'error',
            '-nostdin',
            '-xerror',
            '-protocol_whitelist',
            'file,pipe',
            '-i',
            sourceFile,
            '-map',
            '0:v:0',
            '-map',
            '0:a:0?',
            '-vf',
            `scale=${r.width}:${r.height},setsar=1`,
            '-r',
            '30',
            '-c:v',
            'libx264',
            '-preset',
            'veryfast',
            '-profile:v',
            'main',
            '-level:v',
            '4.1',
            '-pix_fmt',
            'yuv420p',
            '-threads',
            '2',
            '-b:v',
            String(r.bandwidth - 128000),
            '-maxrate',
            String(r.bandwidth),
            '-bufsize',
            String(r.bandwidth * 2),
            '-g',
            '120',
            '-keyint_min',
            '120',
            '-sc_threshold',
            '0',
            '-force_key_frames',
            'expr:gte(t,n_forced*4)',
            '-c:a',
            'aac',
            '-b:a',
            '128k',
            '-ac',
            '2',
            '-f',
            'hls',
            '-hls_time',
            '4',
            '-hls_playlist_type',
            'vod',
            '-hls_flags',
            'independent_segments',
            '-hls_segment_filename',
            join(output, `${r.height}p-%05d.ts`),
            join(output, r.playlist),
          ],
          abort.signal,
        );
      }
      await writeFile(
        join(output, 'master.m3u8'),
        '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-INDEPENDENT-SEGMENTS\n' +
          renditions
            .map(
              (r) =>
                `#EXT-X-STREAM-INF:BANDWIDTH=${r.bandwidth},RESOLUTION=${r.width}x${r.height},CODECS="avc1.4d4029${probe.streams?.some((s) => s.codec_type === 'audio') ? ',mp4a.40.2' : ''}"\n${r.playlist}\n`,
            )
            .join(''),
      );
      const names = await this.validateOutput(output, renditions);
      // Decode complete playlists before declaring READY, not merely their filenames.
      for (const r of renditions)
        await this.run(
          this.settings.ffmpeg,
          [
            '-v',
            'error',
            '-nostdin',
            '-xerror',
            '-protocol_whitelist',
            'file,crypto,data',
            '-i',
            join(output, r.playlist),
            '-f',
            'null',
            '-',
          ],
          abort.signal,
        );
      percent = 85;
      if (!(await onProgress(percent))) throw new VideoProcessingError('CANCELLED');
      let bytes = 0;
      for (const name of names) {
        const key = prefix + '/' + name;
        bytes += await this.storage.uploadFile(
          key,
          join(output, name),
          name.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t',
        );
        uploaded.push(key);
      }
      return { duration: Math.ceil(duration), width, height, renditions, bytes, keys: uploaded };
    } catch (error) {
      await Promise.allSettled(uploaded.map((key) => this.storage.delete(key)));
      throw error;
    } finally {
      clearTimeout(deadline);
      clearInterval(heartbeat);
      this.active.delete(abort);
      await rm(directory, { recursive: true, force: true });
    }
  }
  onModuleDestroy() {
    for (const abort of this.active) abort.abort();
  }
}
