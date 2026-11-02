import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';

/** A full-frame transparent PNG laid over the video between two times. */
export interface ImageOverlay {
  png: string;
  startMs: number;
  endMs: number;
}

export interface EncodeOptions {
  /** Where in the input the MP4 starts, ms. */
  startMs: number;
  /** Filter chain for the video itself, e.g. the zoom. */
  filter?: string;
  /** Laid over the result after the filter, so they aren't zoomed. */
  overlays?: ImageOverlay[];
  fps?: number;
}

const FADE_S = 0.26;
const s3 = (ms: number) => (ms / 1000).toFixed(3);

/** Builds the -filter_complex graph: the video filter, then each overlay faded in and out on top. */
export function overlayGraph(filter: string | undefined, overlays: ImageOverlay[]): string {
  const parts = [`[0:v]${filter ?? 'null'}[v0]`];
  overlays.forEach((o, i) => {
    const n = i + 1;
    const fadeOut = Math.max(o.startMs / 1000, o.endMs / 1000 - FADE_S).toFixed(3);
    parts.push(
      `[${n}:v]format=rgba,fade=t=in:st=${s3(o.startMs)}:d=${FADE_S}:alpha=1,fade=t=out:st=${fadeOut}:d=${FADE_S}:alpha=1[c${n}]`,
      `[v${i}][c${n}]overlay=0:0:shortest=1:enable='between(t,${s3(o.startMs)},${s3(o.endMs)})'[v${n}]`,
    );
  });
  return parts.join(';');
}

/**
 * Converts Playwright's WebM to an H.264 MP4 that plays anywhere, applying the optional filter and
 * overlays. Returns the MP4's length in ms.
 */
export function toMp4(input: string, output: string, opts: EncodeOptions): Promise<number> {
  const ffmpeg = ffmpegPath as unknown as string | null;
  if (!ffmpeg) throw new Error('No ffmpeg binary for this platform (ffmpeg-static found none).');
  const fps = opts.fps ?? 25;
  const overlays = opts.overlays ?? [];

  const graph: string[] = overlays.length
    ? [
        ...overlays.flatMap(o => ['-loop', '1', '-framerate', String(fps), '-i', o.png]),
        '-filter_complex', overlayGraph(opts.filter, overlays),
        '-map', `[v${overlays.length}]`,
      ]
    : opts.filter ? ['-vf', opts.filter] : [];

  const args = [
    '-y', '-hide_banner',
    '-ss', s3(opts.startMs),
    '-i', input,
    ...graph,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an',
    output,
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', d => { stderr += d; });
    proc.on('error', reject);
    proc.on('close', code => {
      if (code !== 0) {
        reject(new Error(`ffmpeg exited with code ${code}:\n${stderr.split('\n').slice(-12).join('\n')}`));
        return;
      }
      // The last progress line holds the encoded length, e.g. "time=00:00:42.36".
      const times = [...stderr.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
      const last = times.at(-1);
      resolve(last ? Math.round(((+last[1] * 60 + +last[2]) * 60 + +last[3]) * 1000) : 0);
    });
  });
}
