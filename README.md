# Showrunner

[![CI](https://github.com/gillersja1/Showrunner/actions/workflows/ci.yml/badge.svg)](https://github.com/gillersja1/Showrunner/actions/workflows/ci.yml)

Write a demo as a script and get a polished video. Showrunner plays a list of
[Playwright](https://playwright.dev) steps in a real browser and records them as an MP4, with:

- **A visible cursor** that glides to each element before it's clicked. Playwright doesn't draw one, so its recordings look like things happen by magic.
- **Captions** from the `say` line on each step, held on screen long enough to read and carried across page loads.
- **Click ripples**, and smooth scrolling to anything off-screen.
- **A timeline** (`.timeline.json`) of every caption and click with its time and position, for editing and auto-zoom later.

Because a demo is just a script, re-recording after a UI change takes one command, not another take.

## Quick start

```bash
npm install
npx playwright install chromium
npm run demo          # records examples/dungeon-tour.json to out/dungeon-tour.mp4
```

## A flow file

```json
{
  "title": "Sign-up tour",
  "baseUrl": "https://example.com",
  "steps": [
    { "goto": "/", "say": "Signing up takes under a minute." },
    { "type": "#email", "text": "ada@example.com", "say": "Enter your email..." },
    { "click": "role=button[name='Sign up']", "say": "...and you're in." },
    { "waitFor": "text=Welcome, Ada", "hold": 1500 }
  ]
}
```

Each step does one thing and can carry a `say` caption. A step with only `say` just shows the caption.

| Step key | What it does |
| --- | --- |
| `goto` | Opens a URL. Relative paths resolve against `baseUrl`. |
| `click` | Glides the cursor to the element and clicks it. |
| `type` + `text` | Clicks a field and types `text` one key at a time. |
| `press` | Presses a key, e.g. `"Enter"`. |
| `hover` | Glides the cursor onto an element. |
| `scrollTo` | Smoothly scrolls an element into view. |
| `waitFor` | Waits until an element is visible. |
| `wait` | Waits a number of milliseconds. |
| `say` | Caption shown during the step. |
| `hold` | Minimum time after the step, in ms. |

Selectors are anything Playwright accepts: CSS, `text=...`, `role=button[name='Save']`, chains with `>>`.

Flow-level settings:

| Setting | Default | Meaning |
| --- | --- | --- |
| `viewport` | `{ "width": 1280, "height": 720 }` | Browser and video size. |
| `pace.holdMs` | `800` | Pause after each step. Steps with captions also wait long enough for them to be read. |
| `pace.cursorMs` | `700` | Longest cursor glide. |
| `pace.typeDelay` | `70` | Delay between typed keys. |
| `warmup` | none | `{ "url": "/", "waitFor": "<selector>" }`: load the app in an unrecorded browser first. Use this for hosts that sleep, like free Render apps, so the video doesn't open on a loading screen. |

## Commands

```text
showrunner record <flow.json> [--out <dir>] [--name <name>] [--headed] [--keep-raw] [--timeout <ms>]
showrunner check <flow.json>
```

`check` validates a flow without opening a browser and lists every problem at once. If a step fails while recording,
Showrunner names the step and keeps the partial recording as `<name>.failed.webm` so you can see what happened.

## Roadmap

- Auto-zoom on clicks, driven by the timeline
- Voiceover from the `say` lines
- A browser editor for trimming and caption tweaks
- Higher-quality capture than Playwright's built-in recorder

## Development

```bash
npm test             # unit tests and an end-to-end recording of a local page
npm run typecheck
npm run build        # compiles the CLI to dist/
```

## License

MIT
