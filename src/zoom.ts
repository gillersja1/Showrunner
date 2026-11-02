// Auto-zoom: turns the clicks in a recording's timeline into a zoom-and-pan path, then into an
// ffmpeg filter. The camera eases in as the cursor heads for a target, holds while the
// click lands, pans from target to target when they come close together, and eases back out.

export interface ZoomOptions {
  /** How far to zoom in, e.g. 1.5 = 150%. */
  scale: number;
  /** Ease-in time before a click, ms. Overlaps the cursor glide. */
  leadMs: number;
  /** How long to stay zoomed after a click, ms. */
  holdMs: number;
  /** Ease-out time, ms. */
  releaseMs: number;
}

export const DEFAULT_ZOOM: ZoomOptions = { scale: 1.5, leadMs: 900, holdMs: 1500, releaseMs: 700 };

/** A moment the camera should look at: a click, a field being typed into, a hover. */
export interface Focus {
  /** When the action lands, ms from the start of the video. */
  t: number;
  /** Centre of the target, in page pixels. */
  x: number;
  y: number;
  /** Extra time the action takes after t (e.g. typing), ms. */
  busyMs?: number;
}

/** One continuous zoomed stretch. Within it the camera pans from focus to focus. */
export interface Shot {
  /** Ease in from start to full, hold until release, ease out until end (ms). */
  start: number;
  full: number;
  release: number;
  end: number;
  focuses: Focus[];
}

/** Groups focuses into shots; focuses closer together than an ease-out-and-in stay in one shot. */
export function planShots(focuses: Focus[], opts: ZoomOptions = DEFAULT_ZOOM): Shot[] {
  const sorted = [...focuses].sort((a, b) => a.t - b.t);
  const shots: Shot[] = [];
  for (const f of sorted) {
    const start = Math.max(0, f.t - opts.leadMs);
    const full = Math.max(start + 1, f.t - 200);
    const release = f.t + (f.busyMs ?? 0) + opts.holdMs;
    const end = release + opts.releaseMs;
    const last = shots.at(-1);
    if (last && start <= last.end) {
      // Too close to zoom out and back in: stay zoomed and pan instead.
      last.focuses.push(f);
      last.release = Math.max(last.release, release);
      last.end = Math.max(last.end, end);
    } else {
      shots.push({ start, full, release, end, focuses: [f] });
    }
  }
  return shots;
}

// ffmpeg expression helpers. T is the output time in seconds.
const num = (v: number) => (Math.round(v * 1000) / 1000).toString();
const sec = (ms: number) => num(ms / 1000);
/** Smoothstep from 0 at time a to 1 at time b (seconds). */
const ease = (a: string, b: string, T: string) => {
  const u = `clip((${T}-${a})/(${b}-${a}),0,1)`;
  return `(${u}*${u}*(3-2*${u}))`;
};

/** Zoom factor over time as an ffmpeg expression. */
export function zoomExpr(shots: Shot[], scale: number, T: string): string {
  let expr = '1';
  for (const s of [...shots].reverse()) {
    const inner =
      `if(lt(${T},${sec(s.full)}),1+${num(scale - 1)}*${ease(sec(s.start), sec(s.full), T)},` +
      `if(lt(${T},${sec(s.release)}),${num(scale)},` +
      `${num(scale)}-${num(scale - 1)}*${ease(sec(s.release), sec(s.end), T)}))`;
    expr = `if(between(${T},${sec(s.start)},${sec(s.end)}),${inner},${expr})`;
  }
  return expr;
}

/** Camera centre on one axis over time: holds on each focus, glides to the next before it lands. */
export function centerExpr(shots: Shot[], axis: 'x' | 'y', fallback: number, opts: ZoomOptions, T: string): string {
  let expr = num(fallback);
  for (const s of [...shots].reverse()) {
    const fs = s.focuses;
    let inner = num(fs[fs.length - 1][axis]);
    for (let i = fs.length - 2; i >= 0; i--) {
      const from = fs[i][axis];
      const to = fs[i + 1][axis];
      // Leave once this focus's own action is done, but no later than the next one's lead.
      const nextLand = fs[i + 1].t - 200;
      const leave = Math.min(Math.max(fs[i].t + (fs[i].busyMs ?? 0) + 300, fs[i + 1].t - opts.leadMs), nextLand - 100);
      inner = `if(lt(${T},${sec(leave)}),${num(from)},` +
        `if(lt(${T},${sec(nextLand)}),${num(from)}+${num(to - from)}*${ease(sec(leave), sec(nextLand), T)},${inner}))`;
    }
    expr = `if(between(${T},${sec(s.start)},${sec(s.end)}),${inner},${expr})`;
  }
  return expr;
}

/**
 * The ffmpeg filter chain that applies the zoom. The input is upscaled first so the camera can sit
 * between whole pixels; zoompan otherwise rounds its position and the picture visibly jitters.
 */
export function zoomFilter(focuses: Focus[], size: { width: number; height: number }, fps: number, opts: ZoomOptions = DEFAULT_ZOOM): string | undefined {
  const shots = planShots(focuses, opts);
  if (shots.length === 0) return undefined;
  const k = 3;
  const W = size.width;
  const H = size.height;
  const T = `(on/${fps})`;
  const z = zoomExpr(shots, opts.scale, T);
  const cx = centerExpr(shots, 'x', W / 2, opts, T);
  const cy = centerExpr(shots, 'y', H / 2, opts, T);
  // zoompan wants the top-left corner of the visible window, in (upscaled) input pixels, kept inside the frame.
  const x = `clip((${cx})*${k}-iw/zoom/2,0,iw-iw/zoom)`;
  const y = `clip((${cy})*${k}-ih/zoom/2,0,ih-ih/zoom)`;
  return [
    `fps=${fps}`,
    `scale=${W * k}:${H * k}:flags=lanczos`,
    `zoompan=z='${z}':x='${x}':y='${y}':d=1:s=${W}x${H}:fps=${fps}`,
  ].join(',');
}
