import { describe, expect, it } from 'vitest';
import { DEFAULT_ZOOM, planShots, zoomFilter } from '../src/zoom.js';

describe('planShots', () => {
  it('gives far-apart clicks their own shots', () => {
    const shots = planShots([{ t: 2000, x: 10, y: 10 }, { t: 10_000, x: 500, y: 300 }]);
    expect(shots).toHaveLength(2);
    expect(shots[0]).toMatchObject({ start: 1100, full: 1800, release: 3500, end: 4200 });
  });

  it('pans between clicks too close to zoom out in between', () => {
    const shots = planShots([{ t: 2000, x: 10, y: 10 }, { t: 4000, x: 500, y: 300 }]);
    expect(shots).toHaveLength(1);
    expect(shots[0].focuses).toHaveLength(2);
    expect(shots[0].end).toBe(4000 + DEFAULT_ZOOM.holdMs + DEFAULT_ZOOM.releaseMs);
  });

  it('holds through typing', () => {
    const [shot] = planShots([{ t: 1000, x: 0, y: 0, busyMs: 2000 }]);
    expect(shot.release).toBe(1000 + 2000 + DEFAULT_ZOOM.holdMs);
  });

  it('never starts before the video does', () => {
    expect(planShots([{ t: 100, x: 0, y: 0 }])[0].start).toBe(0);
  });
});

describe('zoomFilter', () => {
  it('is skipped when nothing was clicked', () => {
    expect(zoomFilter([], { width: 1280, height: 720 }, 25)).toBeUndefined();
  });

  it('upscales, then zooms back down to the original size', () => {
    const f = zoomFilter([{ t: 2000, x: 640, y: 360 }], { width: 1280, height: 720 }, 25)!;
    expect(f).toMatch(/^fps=25,scale=3840:2160:flags=lanczos,zoompan=z='/);
    expect(f).toMatch(/:d=1:s=1280x720:fps=25$/);
  });
});
