import { describe, expect, it } from 'vitest';
import { DEFAULT_PACE, FlowError, actionOf, parseFlow, readingMs } from '../src/flow.js';

const ok = { title: 'Demo', baseUrl: 'https://example.com', steps: [{ goto: '/', say: 'Hi' }] };

function issuesOf(raw: unknown): string[] {
  try {
    parseFlow(raw);
  } catch (e) {
    if (e instanceof FlowError) return e.issues;
    throw e;
  }
  return [];
}

describe('parseFlow', () => {
  it('fills in the default viewport and pace', () => {
    const flow = parseFlow(ok);
    expect(flow.viewport).toEqual({ width: 1280, height: 720 });
    expect(flow.pace).toEqual(DEFAULT_PACE);
  });

  it('merges a partial pace over the defaults', () => {
    const flow = parseFlow({ ...ok, pace: { holdMs: 300 } });
    expect(flow.pace).toEqual({ ...DEFAULT_PACE, holdMs: 300 });
  });

  it('rejects a step with two actions', () => {
    expect(issuesOf({ ...ok, steps: [{ goto: '/', click: 'a' }] })).toEqual([
      'steps[0] has more than one action (goto, click); split it into separate steps.',
    ]);
  });

  it('catches typos in step keys', () => {
    expect(issuesOf({ ...ok, steps: [{ clik: 'a' }] })[0]).toMatch(/"clik" is not a known step key/);
  });

  it('needs text for type, and only for type', () => {
    expect(issuesOf({ ...ok, steps: [{ type: '#q' }] })).toEqual(['steps[0]: "type" needs a "text" to type.']);
    expect(issuesOf({ ...ok, steps: [{ click: '#q', text: 'x' }] })).toEqual(['steps[0]: "text" only goes with "type".']);
  });

  it('rejects relative goto without a baseUrl', () => {
    expect(issuesOf({ title: 'x', steps: [{ goto: '/home' }] })[0]).toMatch(/relative/);
    expect(issuesOf({ title: 'x', steps: [{ goto: 'file:///c:/page.html' }] })).toEqual([]);
  });

  it('allows a caption-only step but not an empty one', () => {
    expect(issuesOf({ ...ok, steps: [{ say: 'Just talking' }] })).toEqual([]);
    expect(issuesOf({ ...ok, steps: [{}] })).toEqual(['steps[0] needs an action or a "say" line.']);
  });

  it('reports every problem at once', () => {
    expect(issuesOf({ steps: [], extra: 1 })).toHaveLength(3);
  });
});

describe('actionOf', () => {
  it('finds the step action', () => {
    expect(actionOf({ say: 'x', wait: 0 })).toBe('wait');
    expect(actionOf({ say: 'x' })).toBeUndefined();
  });
});

describe('readingMs', () => {
  it('scales with words within bounds', () => {
    expect(readingMs(undefined)).toBe(0);
    expect(readingMs('Hi')).toBe(1200);
    expect(readingMs('one two three four five six seven eight nine ten')).toBe(3400);
    expect(readingMs('word '.repeat(100))).toBe(8000);
  });
});

describe('warmup', () => {
  it('defaults the timeout to two minutes', () => {
    expect(parseFlow({ ...ok, warmup: { url: '/', waitFor: 'h1' } }).warmup).toEqual({ url: '/', waitFor: 'h1', timeoutMs: 120_000 });
  });

  it('needs a url and a selector', () => {
    expect(issuesOf({ ...ok, warmup: { url: '/' } })[0]).toMatch(/"warmup" must be/);
  });
});
