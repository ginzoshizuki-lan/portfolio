/* ==========================================================================
   overlay.js — the HTML layer.

   Content stays in the DOM as real text: selectable, translatable, indexable,
   and reachable by a screen reader in document order. All this does is decide
   which panel is currently on screen, based on where the camera is along the
   rail (in waypoint-index space, so panels are pinned to places in the
   building rather than to pixel offsets).
   ========================================================================== */

/* Short fades, and the ranges in index.html leave a gap between consecutive
   panels. With long fades and overlapping ranges, the handover put two panels
   on screen at ~0.2 opacity each: not a cross-fade, just two ghosts over the
   architecture. A beat of pure architecture between them reads far better. */
const FADE_IN = 0.14;
const FADE_OUT = 0.14;

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function createOverlay(journey) {
  const panels = [...document.querySelectorAll('.panel')].map((el) => {
    const [from, to] = (el.dataset.wp || '0,1').split(',').map(Number);
    return { el, from, to, live: false, last: -1 };
  });

  const hudNum = document.getElementById('hud-num');
  const hudName = document.getElementById('hud-name');
  const hudFill = document.getElementById('hud-fill');
  const navLinks = [...document.querySelectorAll('.nav__menu a[data-goto]')];

  let lastStation = null;

  function update(wp, progress) {
    for (const p of panels) {
      const local = (wp - p.from) / (p.to - p.from);
      let o = 0;
      if (local > -0.05 && local < 1.05) {
        o = smoothstep(0, FADE_IN, local) * (1 - smoothstep(1 - FADE_OUT, 1, local));
      }

      if (Math.abs(o - p.last) < 0.004 && p.last >= 0) continue;
      p.last = o;

      const live = o > 0.012;
      if (live !== p.live) {
        p.live = live;
        p.el.classList.toggle('is-live', live);
        /* keep hidden panels out of the accessibility tree so a screen
           reader isn't offered seven copies of the page at once */
        p.el.setAttribute('aria-hidden', live ? 'false' : 'true');
      }
      if (!live) { p.el.style.opacity = '0'; continue; }

      p.el.style.opacity = o.toFixed(3);
      /* arrive from below, leave upward — 18 px is enough to feel deliberate */
      p.el.style.transform = `translate3d(0, ${((1 - o) * (local < 0.5 ? 18 : -18)).toFixed(1)}px, 0)`;
    }

    const station = journey.stationFor(wp);
    if (station !== lastStation) {
      lastStation = station;
      hudNum.textContent = station.num;
      hudName.textContent = station.name;
      for (const a of navLinks) {
        const active = a.dataset.goto === station.key;
        a.setAttribute('aria-current', active ? 'true' : 'false');
      }
    }
    hudFill.style.width = `${(progress * 100).toFixed(2)}%`;
  }

  return { update, panels };
}

/* ── nav ─────────────────────────────────────────────────────────────────
   Links scroll to a waypoint rather than to an element, since the panels are
   all pinned at inset:0 and have no meaningful offsetTop. */
export function wireNav(journey, scrollLength) {
  const toggle = document.querySelector('.nav__toggle');
  const menu = document.getElementById('nav-menu');

  toggle?.addEventListener('click', () => {
    const open = menu.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'メニューを閉じる' : 'メニューを開く');
  });

  for (const a of document.querySelectorAll('.nav__menu a[data-goto], .nav__brand')) {
    a.addEventListener('click', (e) => {
      const key = a.dataset.goto ?? 'hero';
      if (document.documentElement.classList.contains('is-flat')) return; // let the anchor work
      e.preventDefault();
      menu?.classList.remove('is-open');
      toggle?.setAttribute('aria-expanded', 'false');
      window.scrollTo({ top: journey.anchorScroll(key) * scrollLength(), behavior: 'smooth' });
    });
  }

  document.getElementById('year').textContent = String(new Date().getFullYear());
}
