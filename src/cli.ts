#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { FlowError, parseFlow, type Flow } from './flow.js';
import { record } from './record.js';

const USAGE = `showrunner: turn a scripted Playwright flow into a demo video

Usage:
  showrunner record <flow.json> [--out <dir>] [--name <name>] [--headed] [--keep-raw] [--timeout <ms>]
  showrunner check <flow.json>

Commands:
  record    Play the flow in a recorded browser and write <name>.mp4 and <name>.timeline.json
  check     Validate the flow file without opening a browser

Options:
  --out <dir>    Where to write the video (default: out)
  --name <name>  File name for the outputs (default: the flow file's name)
  --headed       Show the browser while recording
  --keep-raw     Also keep Playwright's untrimmed WebM recording
  --timeout <ms> How long a step may wait for its element (default: 30000)
  -h, --help     Show this help
`;

async function loadFlow(file: string): Promise<Flow> {
  const text = await readFile(file, 'utf8');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new FlowError([`${file} is not valid JSON: ${(e as Error).message}`]);
  }
  return parseFlow(raw);
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      out: { type: 'string', default: 'out' },
      name: { type: 'string' },
      headed: { type: 'boolean', default: false },
      'keep-raw': { type: 'boolean', default: false },
      timeout: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  const [command, file] = positionals;
  if (values.help || !command) {
    console.log(USAGE);
    return values.help ? 0 : 1;
  }
  if (command !== 'record' && command !== 'check') {
    console.error(`Unknown command "${command}".\n\n${USAGE}`);
    return 1;
  }
  if (!file) {
    console.error(`"${command}" needs a flow file.\n\n${USAGE}`);
    return 1;
  }

  const flow = await loadFlow(file);
  if (command === 'check') {
    console.log(`${file}: "${flow.title}", ${flow.steps.length} steps. Looks good.`);
    return 0;
  }

  const timeoutMs = values.timeout === undefined ? undefined : Number(values.timeout);
  if (timeoutMs !== undefined && !(timeoutMs > 0)) {
    console.error(`--timeout must be a positive number of milliseconds, not "${values.timeout}".`);
    return 1;
  }

  const name = values.name ?? path.basename(file, path.extname(file));
  console.log(`Recording "${flow.title}" (${flow.steps.length} steps, ${flow.viewport.width}x${flow.viewport.height})`);
  const result = await record(flow, {
    outDir: values.out!,
    name,
    headed: values.headed,
    keepRaw: values['keep-raw'],
    timeoutMs,
    log: m => console.log(m),
  });
  console.log(`\nDone: ${(result.durationMs / 1000).toFixed(1)}s of video`);
  console.log(`  ${path.relative(process.cwd(), result.mp4)}`);
  console.log(`  ${path.relative(process.cwd(), result.timeline)}`);
  if (result.raw) console.log(`  ${path.relative(process.cwd(), result.raw)}`);
  return 0;
}

main(process.argv.slice(2)).then(
  code => { process.exitCode = code; },
  err => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  },
);
