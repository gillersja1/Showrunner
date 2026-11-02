import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { parseFlow } from '../src/flow.js';
import { StepFailed, record } from '../src/record.js';

const fixture = pathToFileURL(path.resolve('test/fixtures/page.html')).href;
const dirs: string[] = [];
const tempDir = async () => {
  const d = await mkdtemp(path.join(os.tmpdir(), 'showrunner-'));
  dirs.push(d);
  return d;
};
afterAll(() => Promise.all(dirs.map(d => rm(d, { recursive: true, force: true }))));

describe('record', () => {
  it('records a flow to MP4 with a timeline of clicks', async () => {
    const outDir = await tempDir();
    const flow = parseFlow({
      title: 'Fixture',
      viewport: { width: 800, height: 600 },
      pace: { holdMs: 100, typeDelay: 10 },
      steps: [
        { goto: fixture, say: 'Open the page' },
        { type: '#name', text: 'Ada' },
        { click: 'role=button[name="Greet"]', say: 'Say hello' },
        { waitFor: 'text=Hello, Ada!' },
        { click: 'text=Next page' },
        { waitFor: 'role=heading[name="Second page"]', say: 'The caption follows to the next page' },
      ],
    });

    const result = await record(flow, { outDir, name: 'fixture' });

    expect((await stat(result.mp4)).size).toBeGreaterThan(10_000);
    expect(result.durationMs).toBeGreaterThan(3000);
    const timeline = JSON.parse(await readFile(result.timeline, 'utf8'));
    const clicks = timeline.events.filter((e: { kind: string }) => e.kind === 'click');
    expect(clicks).toHaveLength(2);
    expect(clicks[0]).toMatchObject({ step: 2 });
    expect(clicks[0].x).toBeGreaterThan(0);
    // Times are relative to the trimmed video, in order.
    const times = timeline.events.map((e: { t: number }) => e.t);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  }, 120_000);

  it('names the failing step and keeps the partial recording', async () => {
    const outDir = await tempDir();
    const flow = parseFlow({
      title: 'Broken',
      pace: { holdMs: 0 },
      steps: [{ goto: fixture }, { click: '#missing', say: 'Click nothing' }],
    });
    // Fail fast instead of waiting the default 30s.
    const failing = record(flow, { outDir, name: 'broken', timeoutMs: 1000 });
    await expect(failing).rejects.toThrow(StepFailed);
    await expect(failing).rejects.toThrow(/Step 2 \(click: "Click nothing"\)/);
    expect((await stat(path.join(outDir, 'broken.failed.webm'))).size).toBeGreaterThan(0);
  }, 60_000);
});
