// The flow file: a list of Playwright steps, each with an optional line of narration.

import { DEFAULT_ZOOM, type ZoomOptions } from './zoom.js';

export const ACTIONS = ['goto', 'click', 'type', 'press', 'hover', 'scrollTo', 'waitFor', 'wait'] as const;
export type Action = (typeof ACTIONS)[number];

export interface Step {
  /** Caption shown while this step plays. */
  say?: string;
  /** URL to open; relative paths resolve against the flow's baseUrl. */
  goto?: string;
  /** Selector to click (any Playwright selector: css, text=, role=...). */
  click?: string;
  /** Selector of a field to type `text` into, one key at a time. */
  type?: string;
  text?: string;
  /** Key to press on the focused element, e.g. "Enter". */
  press?: string;
  /** Selector to move the cursor onto. */
  hover?: string;
  /** Selector to scroll smoothly into view. */
  scrollTo?: string;
  /** Selector to wait for until it is visible. */
  waitFor?: string;
  /** Milliseconds to wait. */
  wait?: number;
  /** Minimum time on screen after the action, in ms. Defaults to the flow's pace.holdMs. */
  hold?: number;
}

export interface Pace {
  /** Delay between typed keys, ms. */
  typeDelay: number;
  /** Longest cursor glide, ms. */
  cursorMs: number;
  /** Default pause after each step, ms. */
  holdMs: number;
}

export interface Warmup {
  /** Page to open before recording starts; relative paths resolve against baseUrl. */
  url: string;
  /** Selector that shows the real app has loaded. */
  waitFor: string;
  /** How long to wait for it, ms. */
  timeoutMs: number;
}

export interface Flow {
  title: string;
  baseUrl?: string;
  /** Wakes a sleeping host (e.g. a free Render or Heroku app) in an unrecorded browser first. */
  warmup?: Warmup;
  viewport: { width: number; height: number };
  pace: Pace;
  /** Auto-zoom on clicks and typing, or false for none. */
  zoom: ZoomOptions | false;
  steps: Step[];
}

export const DEFAULT_PACE: Pace = { typeDelay: 70, cursorMs: 700, holdMs: 800 };
export const DEFAULT_VIEWPORT = { width: 1280, height: 720 };

const STEP_KEYS = new Set<string>(['say', 'text', 'hold', ...ACTIONS]);

export class FlowError extends Error {
  constructor(public readonly issues: string[]) {
    super(`The flow has ${issues.length} problem${issues.length === 1 ? '' : 's'}:\n` + issues.map(i => `  - ${i}`).join('\n'));
    this.name = 'FlowError';
  }
}

export function actionOf(step: Step): Action | undefined {
  return ACTIONS.find(a => step[a] !== undefined);
}

/** How long a caption needs on screen to be read comfortably. */
export function readingMs(text: string | undefined): number {
  if (!text) return 0;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.min(8000, Math.max(1200, 600 + words * 280));
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isPositiveInt = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v > 0;
const isNonNegative = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** Checks a parsed flow file and fills in defaults. Throws FlowError listing every problem found. */
export function parseFlow(raw: unknown): Flow {
  const issues: string[] = [];
  if (!isObject(raw)) throw new FlowError(['The flow must be a JSON object.']);

  const title = raw.title;
  if (typeof title !== 'string' || !title.trim()) issues.push('"title" must be a non-empty string.');

  const baseUrl = raw.baseUrl;
  if (baseUrl !== undefined) {
    if (typeof baseUrl !== 'string') issues.push('"baseUrl" must be a string.');
    else {
      try { new URL(baseUrl); } catch { issues.push(`"baseUrl" is not a valid URL: ${baseUrl}`); }
    }
  }

  let warmup: Warmup | undefined;
  if (raw.warmup !== undefined) {
    const w = raw.warmup;
    if (!isObject(w) || typeof w.url !== 'string' || !w.url.trim() || typeof w.waitFor !== 'string' || !w.waitFor.trim()) {
      issues.push('"warmup" must be { "url": <string>, "waitFor": <selector>, "timeoutMs"?: <ms> }.');
    } else if (w.timeoutMs !== undefined && !isPositiveInt(w.timeoutMs)) {
      issues.push('"warmup.timeoutMs" must be a whole number of milliseconds.');
    } else if (typeof baseUrl !== 'string' && !/^[a-z][a-z0-9+.-]*:/i.test(w.url)) {
      issues.push(`"warmup.url" is relative (${w.url}) but the flow has no "baseUrl".`);
    } else {
      warmup = { url: w.url, waitFor: w.waitFor, timeoutMs: (w.timeoutMs as number | undefined) ?? 120_000 };
    }
  }

  let viewport = DEFAULT_VIEWPORT;
  if (raw.viewport !== undefined) {
    const v = raw.viewport;
    if (!isObject(v) || !isPositiveInt(v.width) || !isPositiveInt(v.height)) {
      issues.push('"viewport" must be { "width": <int>, "height": <int> }.');
    } else viewport = { width: v.width as number, height: v.height as number };
  }

  let pace = DEFAULT_PACE;
  if (raw.pace !== undefined) {
    if (!isObject(raw.pace)) issues.push('"pace" must be an object.');
    else {
      for (const [k, v] of Object.entries(raw.pace)) {
        if (!(k in DEFAULT_PACE)) issues.push(`"pace.${k}" is not a known setting (use ${Object.keys(DEFAULT_PACE).join(', ')}).`);
        else if (!isNonNegative(v)) issues.push(`"pace.${k}" must be a number of milliseconds.`);
      }
      pace = { ...DEFAULT_PACE, ...(raw.pace as Partial<Pace>) };
    }
  }

  let zoom: ZoomOptions | false = DEFAULT_ZOOM;
  if (raw.zoom === false) zoom = false;
  else if (raw.zoom !== undefined && raw.zoom !== true) {
    if (!isObject(raw.zoom)) issues.push('"zoom" must be false, true, or an object of settings.');
    else {
      for (const [k, v] of Object.entries(raw.zoom)) {
        if (!(k in DEFAULT_ZOOM)) issues.push(`"zoom.${k}" is not a known setting (use ${Object.keys(DEFAULT_ZOOM).join(', ')}).`);
        else if (!isNonNegative(v)) issues.push(`"zoom.${k}" must be a non-negative number.`);
        else if (k === 'scale' && ((v as number) < 1 || (v as number) > 4)) issues.push('"zoom.scale" must be between 1 and 4.');
      }
      zoom = { ...DEFAULT_ZOOM, ...(raw.zoom as Partial<ZoomOptions>) };
    }
  }

  const steps = raw.steps;
  if (!Array.isArray(steps) || steps.length === 0) {
    issues.push('"steps" must be a non-empty array.');
  } else {
    steps.forEach((s, i) => checkStep(s, `steps[${i}]`, typeof baseUrl === 'string', issues));
  }

  for (const k of Object.keys(raw)) {
    if (!['title', 'baseUrl', 'warmup', 'viewport', 'pace', 'zoom', 'steps', '$schema'].includes(k)) issues.push(`"${k}" is not a known flow setting.`);
  }

  if (issues.length) throw new FlowError(issues);
  return { title: title as string, baseUrl: baseUrl as string | undefined, warmup, viewport, pace, zoom, steps: steps as Step[] };
}

function checkStep(s: unknown, where: string, hasBaseUrl: boolean, issues: string[]) {
  if (!isObject(s)) {
    issues.push(`${where} must be an object.`);
    return;
  }
  for (const k of Object.keys(s)) {
    if (!STEP_KEYS.has(k)) issues.push(`${where}: "${k}" is not a known step key (use ${[...STEP_KEYS].join(', ')}).`);
  }
  const actions = ACTIONS.filter(a => s[a] !== undefined);
  if (actions.length > 1) issues.push(`${where} has more than one action (${actions.join(', ')}); split it into separate steps.`);
  if (actions.length === 0 && s.say === undefined) issues.push(`${where} needs an action or a "say" line.`);

  if (s.say !== undefined && typeof s.say !== 'string') issues.push(`${where}: "say" must be a string.`);
  if (s.hold !== undefined && !isNonNegative(s.hold)) issues.push(`${where}: "hold" must be a number of milliseconds.`);

  for (const a of actions) {
    const v = s[a];
    if (a === 'wait') {
      if (!isNonNegative(v)) issues.push(`${where}: "wait" must be a number of milliseconds.`);
    } else if (typeof v !== 'string' || !v.trim()) {
      issues.push(`${where}: "${a}" must be a non-empty string.`);
    } else if (a === 'goto' && !hasBaseUrl && !/^[a-z][a-z0-9+.-]*:/i.test(v)) {
      issues.push(`${where}: "goto" is relative (${v}) but the flow has no "baseUrl".`);
    }
  }

  if (s.type !== undefined && typeof s.text !== 'string') issues.push(`${where}: "type" needs a "text" to type.`);
  if (s.text !== undefined && s.type === undefined) issues.push(`${where}: "text" only goes with "type".`);
}
