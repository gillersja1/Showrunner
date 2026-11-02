import { describe, expect, it } from 'vitest';
import { overlayGraph } from '../src/encode.js';
import { captionsOf, type TimelineEvent } from '../src/record.js';

describe('captionsOf', () => {
  it('runs each caption until the next step, skipping steps without one', () => {
    const events: TimelineEvent[] = [
      { t: 0, step: 0, kind: 'step', say: 'One' },
      { t: 500, step: 0, kind: 'click', x: 1, y: 1 },
      { t: 2000, step: 1, kind: 'step' },
      { t: 3000, step: 2, kind: 'step', say: 'Two' },
      { t: 5000, step: 3, kind: 'end' },
    ];
    expect(captionsOf(events)).toEqual([
      { text: 'One', startMs: 0, endMs: 2000 },
      { text: 'Two', startMs: 3000, endMs: 5000 },
    ]);
  });
});

describe('overlayGraph', () => {
  it('chains the video filter and then each faded overlay', () => {
    const g = overlayGraph('fps=25', [
      { png: 'a.png', startMs: 0, endMs: 2000 },
      { png: 'b.png', startMs: 3000, endMs: 5000 },
    ]);
    expect(g.split(';')).toEqual([
      '[0:v]fps=25[v0]',
      '[1:v]format=rgba,fade=t=in:st=0.000:d=0.26:alpha=1,fade=t=out:st=1.740:d=0.26:alpha=1[c1]',
      "[v0][c1]overlay=0:0:shortest=1:enable='between(t,0.000,2.000)'[v1]",
      '[2:v]format=rgba,fade=t=in:st=3.000:d=0.26:alpha=1,fade=t=out:st=4.740:d=0.26:alpha=1[c2]',
      "[v1][c2]overlay=0:0:shortest=1:enable='between(t,3.000,5.000)'[v2]",
    ]);
  });
});
