// Injected into every page before its own scripts run. Draws the cursor, captions and click
// ripples in a closed shadow root so the page's CSS can't reach them, and the page's own
// scripts can't easily find them.
//
// Kept as a plain string, not a function: the TypeScript loader can add helper calls to
// compiled functions, and those helpers don't exist inside the browser.

/** Caption styling, shared by the live overlay and the caption images burned in after a zoom. */
export const CAPTION_CSS = [
  '.caption { position: absolute; left: 50%; bottom: 36px; transform: translate(-50%, 12px); max-width: min(80%, 980px);',
  '  padding: 14px 24px; border-radius: 14px; background: rgba(12, 14, 20, .86); color: #fff;',
  '  font: 600 24px/1.35 system-ui, "Segoe UI", Roboto, sans-serif; text-align: center; letter-spacing: .01em;',
  '  box-shadow: 0 8px 30px rgba(0,0,0,.35); opacity: 0; transition: opacity 260ms, transform 260ms; }',
  '.caption.on { opacity: 1; transform: translate(-50%, 0); }',
].join('\n');

/** Set before OVERLAY_SCRIPT to draw the cursor but leave captions to the encoder. */
export const HIDE_CAPTIONS_SCRIPT = 'window.__showrunnerHideCaptions = true;';

export const OVERLAY_SCRIPT = String.raw`
(() => {
  if (window.__showrunner) return;
  const KEY = '__showrunner_state';
  const state = { x: -60, y: -60, caption: '' };
  try { Object.assign(state, JSON.parse(sessionStorage.getItem(KEY) || '{}')); } catch (e) {}
  const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} };

  let root = null, cursor = null, caption = null, ready = false;

  const CSS = [
    ':host { all: initial; }',
    '.layer { position: fixed; inset: 0; pointer-events: none; overflow: hidden; }',
    '.cursor { position: absolute; left: 0; top: 0; width: 28px; height: 28px; will-change: transform;',
    '  filter: drop-shadow(0 2px 3px rgba(0,0,0,.45)); }',
    '.cursor.press svg { transform: scale(.82); transform-origin: 4px 3px; transition: transform 90ms; }',
    '.cursor svg { transition: transform 140ms; }',
    '.ripple { position: absolute; width: 16px; height: 16px; margin: -8px 0 0 -8px; border-radius: 50%;',
    '  border: 3px solid rgba(255, 196, 0, .95); animation: ripple 600ms ease-out forwards; }',
    '@keyframes ripple { from { transform: scale(.4); opacity: 1; } to { transform: scale(3.4); opacity: 0; } }',
  ].join('\n') + '\n' + ${JSON.stringify(CAPTION_CSS)};

  const CURSOR_SVG = '<svg width="28" height="28" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M4 3 L4 23 L9.5 18 L13 26 L16.5 24.5 L13 16.8 L20.5 16.8 Z" fill="#111" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/></svg>';

  // The arrow's tip sits at (4, 3) inside the SVG; offset so the tip lands on the point.
  const place = () => { if (cursor) cursor.style.transform = 'translate(' + (state.x - 4) + 'px,' + (state.y - 3) + 'px)'; };

  const showCaption = (text) => {
    state.caption = text || '';
    save();
    if (!caption) return;
    if (state.caption) {
      caption.textContent = state.caption;
      caption.classList.add('on');
    } else {
      caption.classList.remove('on');
    }
  };

  const mount = () => {
    const host = document.createElement('showrunner-overlay');
    host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = '<style>' + CSS + '</style><div class="layer"><div class="caption"></div>' +
      '<div class="cursor">' + CURSOR_SVG + '</div></div>';
    (document.body || document.documentElement).appendChild(host);
    root = shadow.querySelector('.layer');
    cursor = shadow.querySelector('.cursor');
    caption = shadow.querySelector('.caption');
    if (window.__showrunnerHideCaptions) caption.style.display = 'none';
    place();
    if (state.caption) {
      caption.textContent = state.caption;
      // Already showing on the last page: skip the fade so a navigation doesn't flicker it.
      caption.style.transition = 'none';
      caption.classList.add('on');
      requestAnimationFrame(() => requestAnimationFrame(() => { caption.style.transition = ''; }));
    }
    ready = true;
  };

  const ease = (t) => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  window.__showrunner = {
    get ready() { return ready; },
    caption: showCaption,
    moveTo(x, y, ms) {
      const fromX = state.x, fromY = state.y;
      return new Promise((resolve) => {
        if (!cursor || ms <= 0) { state.x = x; state.y = y; place(); save(); resolve(); return; }
        const start = performance.now();
        const frame = (now) => {
          const t = Math.min(1, (now - start) / ms);
          const k = ease(t);
          state.x = fromX + (x - fromX) * k;
          state.y = fromY + (y - fromY) * k;
          place();
          if (t < 1) requestAnimationFrame(frame); else { save(); resolve(); }
        };
        requestAnimationFrame(frame);
      });
    },
    press() {
      if (!cursor || !root) return;
      cursor.classList.add('press');
      setTimeout(() => cursor.classList.remove('press'), 160);
      const r = document.createElement('div');
      r.className = 'ripple';
      r.style.left = state.x + 'px';
      r.style.top = state.y + 'px';
      root.appendChild(r);
      setTimeout(() => r.remove(), 700);
    },
    restore(s) {
      state.x = s.x; state.y = s.y;
      place();
      if (s.caption !== state.caption) showCaption(s.caption);
      save();
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
`;
