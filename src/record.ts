import { mkdir, rename, rm, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Browser, type Locator, type Page } from 'playwright';
import { actionOf, readingMs, type Flow, type Pace, type Step } from './flow.js';
import { OVERLAY_SCRIPT } from './overlay.js';
import { toMp4 } from './encode.js';

interface OverlayApi {
  ready: boolean;
  caption(text: string): void;
  moveTo(x: number, y: number, ms: number): Promise<void>;
  press(): void;
  restore(s: { x: number; y: number; caption: string }): void;
}

declare global {
  interface Window {
    __showrunner?: OverlayApi;
  }
}

export interface RecordOptions {
  outDir: string;
  name: string;
  headed?: boolean;
  /** Keep Playwright's untrimmed WebM next to the MP4. */
  keepRaw?: boolean;
  /** How long each step may wait for its element, ms (default 30s). */
  timeoutMs?: number;
  log?: (message: string) => void;
}

export interface TimelineEvent {
  /** Milliseconds from the start of the finished video. */
  t: number;
  step: number;
  kind: 'step' | 'click' | 'type' | 'hover' | 'press' | 'navigate';
  say?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface RecordResult {
  mp4: string;
  raw?: string;
  timeline: string;
  durationMs: number;
}

export class StepFailed extends Error {
  constructor(public readonly index: number, step: Step, cause: unknown) {
    const what = actionOf(step) ?? 'say';
    const detail = cause instanceof Error ? cause.message.split('\n')[0] : String(cause);
    super(`Step ${index + 1} (${what}${step.say ? `: "${step.say}"` : ''}) failed: ${detail}`, { cause });
    this.name = 'StepFailed';
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Plays the flow in a recorded browser and writes <name>.mp4 and <name>.timeline.json to outDir. */
export async function record(flow: Flow, opts: RecordOptions): Promise<RecordResult> {
  const log = opts.log ?? (() => {});
  const outDir = path.resolve(opts.outDir);
  const browser = await chromium.launch({ headless: !opts.headed });
  if (flow.warmup) {
    log(`  warming up ${flow.warmup.url}...`);
    await warmUp(browser, flow);
  }

  const rawDir = path.join(outDir, `.raw-${process.pid}-${Date.now()}`);
  await mkdir(rawDir, { recursive: true });
  const context = await browser.newContext({
    viewport: flow.viewport,
    baseURL: flow.baseUrl,
    recordVideo: { dir: rawDir, size: flow.viewport },
  });
  context.setDefaultTimeout(opts.timeoutMs ?? 30_000);
  // Free hosts can take a while to wake up.
  context.setDefaultNavigationTimeout(90_000);
  await context.addInitScript(OVERLAY_SCRIPT);

  const page = await context.newPage();
  const t0 = Date.now();
  const stage = new Stage(page, flow.pace, flow.viewport);
  const events: TimelineEvent[] = [];
  let failure: StepFailed | undefined;

  try {
    for (const [i, step] of flow.steps.entries()) {
      const action = actionOf(step);
      log(`  ${String(i + 1).padStart(2)}/${flow.steps.length}  ${action ?? 'say'}${describe(step)}`);
      try {
        await stage.caption(step.say ?? '');
        const shownAt = Date.now();
        events.push({ t: shownAt - t0, step: i, kind: 'step', say: step.say });

        const target = await stage.perform(step);
        if (target) events.push({ t: target.at - t0, step: i, kind: target.kind, ...target.box });

        const hold = Math.max(step.hold ?? flow.pace.holdMs, readingMs(step.say) - (Date.now() - shownAt));
        await sleep(hold);
      } catch (e) {
        throw new StepFailed(i, step, e);
      }
    }
    await stage.caption('');
    await sleep(500);
  } catch (e) {
    failure = e instanceof StepFailed ? e : new StepFailed(-1, {}, e);
  } finally {
    await context.close();
    await browser.close();
  }

  const video = page.video();
  if (!video) throw new Error('Playwright did not record a video.');
  const rawVideo = await video.path();

  // The recording starts on a blank tab; begin the finished video when the first page has drawn.
  const trimMs = Math.max(0, (stage.firstReadyAt ?? t0) - t0 - 100);
  const base = path.join(outDir, opts.name);
  const mp4 = `${base}.mp4`;
  const timeline = `${base}.timeline.json`;
  let raw: string | undefined;

  try {
    if (failure) {
      // Keep what was recorded so the failure can be watched.
      raw = `${base}.failed.webm`;
      await moveFile(rawVideo, raw);
      throw failure;
    }
    log('  encoding MP4...');
    const durationMs = await toMp4(rawVideo, mp4, trimMs);
    const shifted = events.map(e => ({ ...e, t: Math.max(0, e.t - trimMs) }));
    await writeFile(timeline, JSON.stringify({ title: flow.title, viewport: flow.viewport, durationMs, events: shifted }, null, 2));
    if (opts.keepRaw) {
      raw = `${base}.raw.webm`;
      await moveFile(rawVideo, raw);
    }
    return { mp4, raw, timeline, durationMs };
  } finally {
    await rm(rawDir, { recursive: true, force: true });
  }
}

/** Loads the app in a throwaway, unrecorded context until it is really up. */
async function warmUp(browser: Browser, flow: Flow) {
  const { url, waitFor, timeoutMs } = flow.warmup!;
  const context = await browser.newContext({ baseURL: flow.baseUrl });
  try {
    const page = await context.newPage();
    const deadline = Date.now() + timeoutMs;
    await page.goto(url, { timeout: timeoutMs });
    // A waking host may show a holding page first, then swap in the app.
    await page.locator(waitFor).first().waitFor({ state: 'attached', timeout: Math.max(1000, deadline - Date.now()) });
  } catch (e) {
    await context.close().catch(() => {});
    await browser.close();
    throw new Error(`Warm-up failed: ${url} never showed ${waitFor} (${(e as Error).message.split('\n')[0]})`, { cause: e });
  } finally {
    await context.close().catch(() => {});
  }
}

function describe(step: Step): string {
  const action = actionOf(step);
  const target = action && action !== 'wait' ? step[action] : action === 'wait' ? `${step.wait}ms` : undefined;
  return (target !== undefined ? `  ${target}` : '') + (step.say ? `  "${step.say}"` : '');
}

async function moveFile(from: string, to: string) {
  try {
    await rename(from, to);
  } catch {
    // Different drive, or Windows still holding the file: copy instead.
    await copyFile(from, to);
  }
}

interface Box { x: number; y: number; width: number; height: number }

/** Drives the page and keeps the overlay (cursor, caption) in step across navigations. */
class Stage {
  private x: number;
  private y: number;
  private text = '';
  firstReadyAt: number | undefined;

  constructor(private readonly page: Page, private readonly pace: Pace, viewport: { width: number; height: number }) {
    this.x = viewport.width / 2;
    this.y = viewport.height * 0.6;
  }

  async caption(text: string) {
    this.text = text;
    if (await this.isReady()) await this.page.evaluate(t => window.__showrunner!.caption(t), text);
  }

  async perform(step: Step): Promise<{ kind: TimelineEvent['kind']; at: number; box?: Box } | undefined> {
    const page = this.page;
    switch (actionOf(step)) {
      case 'goto': {
        await page.goto(step.goto!);
        await this.sync();
        return { kind: 'navigate', at: Date.now() };
      }
      case 'click': {
        const loc = page.locator(step.click!);
        const box = await this.pointAt(loc);
        const at = Date.now();
        await page.evaluate(() => window.__showrunner?.press());
        await loc.click();
        await this.settle();
        return { kind: 'click', at, box };
      }
      case 'type': {
        const loc = page.locator(step.type!);
        const box = await this.pointAt(loc);
        const at = Date.now();
        await page.evaluate(() => window.__showrunner?.press());
        await loc.click();
        await loc.pressSequentially(step.text!, { delay: this.pace.typeDelay });
        return { kind: 'type', at, box };
      }
      case 'hover': {
        const box = await this.pointAt(page.locator(step.hover!));
        return { kind: 'hover', at: Date.now(), box };
      }
      case 'press': {
        const at = Date.now();
        await page.keyboard.press(step.press!);
        await this.settle();
        return { kind: 'press', at };
      }
      case 'scrollTo': {
        const loc = page.locator(step.scrollTo!);
        await loc.waitFor({ state: 'attached' });
        await this.smoothScroll(loc);
        return undefined;
      }
      case 'waitFor': {
        await page.locator(step.waitFor!).waitFor({ state: 'visible' });
        return undefined;
      }
      case 'wait': {
        await sleep(step.wait!);
        return undefined;
      }
      default:
        return undefined;
    }
  }

  /** Scrolls the element into view if needed, then glides the cursor to its centre. */
  private async pointAt(loc: Locator): Promise<Box> {
    await loc.waitFor({ state: 'visible' });
    let box = await loc.boundingBox();
    const vp = this.page.viewportSize()!;
    if (!box || box.y < 0 || box.y + box.height > vp.height || box.x < 0 || box.x + box.width > vp.width) {
      await this.smoothScroll(loc);
      box = await loc.boundingBox();
    }
    if (!box) throw new Error('The element has no size on screen.');
    const x = Math.round(box.x + box.width / 2);
    const y = Math.round(box.y + box.height / 2);
    const distance = Math.hypot(x - this.x, y - this.y);
    const ms = Math.round(Math.min(this.pace.cursorMs, Math.max(250, distance * 0.9)));
    await this.page.evaluate(([px, py, pms]) => window.__showrunner!.moveTo(px, py, pms), [x, y, ms] as const);
    this.x = x;
    this.y = y;
    await this.page.mouse.move(x, y);
    await sleep(120);
    return box;
  }

  private async smoothScroll(loc: Locator) {
    await loc.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    // Wait for the scroll to come to rest.
    let last = -1;
    for (let i = 0; i < 40; i++) {
      await sleep(80);
      const y = await this.page.evaluate(() => window.scrollY);
      if (y === last) break;
      last = y;
    }
  }

  /** After an input that may navigate: wait for any new page, then bring the overlay back. */
  private async settle() {
    await sleep(200);
    await this.page.waitForLoadState('load');
    await this.sync();
  }

  private async isReady(): Promise<boolean> {
    try {
      return await this.page.evaluate(() => window.__showrunner?.ready === true);
    } catch {
      return false;
    }
  }

  /** Waits for the overlay on the current page and restores the cursor and caption on it. */
  private async sync() {
    for (let attempt = 0; ; attempt++) {
      try {
        await this.page.waitForFunction(() => window.__showrunner?.ready === true, undefined, { timeout: 10_000 });
        await this.page.evaluate(s => window.__showrunner!.restore(s), { x: this.x, y: this.y, caption: this.text });
        this.firstReadyAt ??= Date.now();
        return;
      } catch (e) {
        // A navigation that starts mid-call destroys the page's context; try again on the new page.
        if (attempt >= 3) throw e;
        await this.page.waitForLoadState('load');
      }
    }
  }
}
