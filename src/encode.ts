import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';

/** Converts Playwright's WebM to an H.264 MP4 that plays anywhere, starting startMs in. Returns the MP4's length in ms. */
export function toMp4(input: string, output: string, startMs: number): Promise<number> {
  const ffmpeg = ffmpegPath as unknown as string | null;
  if (!ffmpeg) throw new Error('No ffmpeg binary for this platform (ffmpeg-static found none).');

  const args = [
    '-y', '-hide_banner',
    '-ss', (startMs / 1000).toFixed(3),
    '-i', input,
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
