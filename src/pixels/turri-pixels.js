/**
 * turri pixel art — animations + logos, extracted from the D5-Lean design mockup.
 *
 * Zero dependencies, no framework. Works as an ES module or a plain <script> (UMD-ish
 * global `TurriPixels`). Pair with turri-pixels.css for the keyframe animations.
 *
 *   import * as Turri from './turri-pixels.js';
 *   Turri.mountJellyfish(document.querySelector('#hero'));
 *   Turri.mountLogo(document.querySelector('#logo'), 4);
 *
 * Every sprite is a list of absolutely-positioned square cells:
 *   { l, t, s, c, o } = left, top, size (all css px strings), color, opacity
 */

export const PALETTE = {
  // turri desktop: each colour the theme's token (styles.css), with the kit's own after it - a cell's background is set to
  // one, so the jellyfish takes the theme's colours, and turri's where there is no theme.
  pink: 'var(--jelly-bell, #FF5C8D)',      // jelly bell, primary accent
  mid:  'var(--jelly-mid, #A9479A)',       // bell midtone
  ind:  'var(--jelly-shadow, #5B57D9)',    // bell shadow
  egg:  'var(--jelly-rim, #732553)',       // bell rim
  or:   'var(--jelly-core, #FF7A3D)',      // core / eye glow
  neon: 'var(--jelly-tentacle, #5CE1E6)',  // tentacles, secondary accent
  hi:   'var(--jelly-highlight, #FF7FA6)', // specular highlight
  gz:   'var(--jelly-ghost, #85A3B2)',     // muted body text / ghost pixels
  line: 'var(--jelly-ground, #22344A)'     // ground line, hairlines
};

/* Surface colors the sprites are designed against. */
export const THEME = {
  bg:      '#0A0F1A',
  panel:   '#142030',
  panelHi: '#1E3442',
  border:  '#22344A',
  dim:     '#3E5A6B',
  text:    '#F4F7F9',
  body:    '#85A3B2',
  cream:   '#E9D8C8'
};

const P = PALETTE;

/* ------------------------------------------------------------------ *
 * shared pixel helpers
 * ------------------------------------------------------------------ */

const band = (t, x, y) =>
  t < 0.3  ? P.pink
: t < 0.42 ? ((x + y) % 2 ? P.pink : P.mid)
: t < 0.62 ? P.mid
: t < 0.74 ? ((x + y) % 2 ? P.mid : P.ind)
           : P.ind;

const mapCell = (size) => {
  const g = (size - 1) + 'px';
  return (c) => ({ l: (c.x * size) + 'px', t: (c.y * size) + 'px', s: g, c: c.c, o: c.o });
};

/* ------------------------------------------------------------------ *
 * 1. static sprites — 'hero' | 'polyp' | 'budding' | 'medusa' | 'regrow'
 *
 * Returns { base, fa, fb }. `base` is the still body; `fa` and `fb` are two
 * alternating tentacle frames — cross-fade them with the .fa / .fb classes
 * from turri-pixels.css for the idle sway.
 * ------------------------------------------------------------------ */
export function sprite(stage, size = 10) {
  const base = new Map(), fa = [], fb = [];
  const put = (x, y, c, o) => base.set(x + ',' + y, { x, y, c, o: o == null ? 1 : o });
  const st = (x, y, o) => put(x, y, P.neon, o);

  const shape = (cx, cy, rx, ry, dome) => {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      if (dome && y > cy) continue;
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) {
          const t = dome ? (y - (cy - ry)) / ry : (y - (cy - ry)) / (2 * ry);
          put(x, y, band(Math.max(0, Math.min(1, t)), x, y));
        }
      }
    }
  };
  const tent = (x0, y0, len, i, amp, off = 0) => {
    for (let k = 0; k < len; k++) {
      const a = k < off ? 0 : amp * ((k - off) / Math.max(1, len - off));
      const o = k % 2 ? 0.5 : 1;
      fa.push({ x: x0 + Math.round(Math.sin(k * 0.5 + i) * a),       y: y0 + k, c: P.neon, o });
      fb.push({ x: x0 + Math.round(Math.sin(k * 0.5 + i + 2.2) * a), y: y0 + k, c: P.neon, o });
    }
  };
  const stalk = (x0, x1, y0, y1) => {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++)
        put(x, y, band(0.45 + 0.55 * (y - y0) / Math.max(1, y1 - y0), x, y));
  };
  const ground = () => { for (let x = 0; x < 22; x++) put(x, 23, P.line); };
  const polyp = () => {
    stalk(10, 11, 12, 22);
    shape(11, 9, 3.6, 3.6, false);
    put(10, 9, P.or); put(11, 9, P.or); put(10, 10, P.or); put(11, 10, P.or);
    [[7,6],[6,5],[5,4],[14,6],[15,5],[16,4],[10,4],[10,3],[12,4],[12,3]]
      .forEach((p, i) => st(p[0], p[1], i % 2 ? 0.6 : 1));
    stalk(4, 4, 18, 22);
    shape(4.5, 16.5, 2, 2, false);
    put(4, 16, P.or);
    [[2,14],[1,13],[7,14],[8,13]].forEach((p) => st(p[0], p[1]));
    ground();
  };

  if (stage === 'hero') {
    shape(20.5, 18, 14.5, 16, true);
    for (let x = 0; x < 41; x++) {
      const k = x + ',18';
      if (base.has(k)) { if (Math.abs(x - 20) % 4 === 2) base.delete(k); else base.get(k).c = P.egg; }
    }
    [[11,6],[12,5],[13,5],[10,7],[11,7],[14,4]]
      .forEach((p) => { if (base.has(p[0] + ',' + p[1])) put(p[0], p[1], P.hi); });
    for (let y = 10; y <= 12; y++) for (let x = 18; x <= 22; x++) put(x, y, P.or);
    for (let x = 19; x <= 21; x++) { put(x, 9, P.or); put(x, 13, P.or); }
    [8,10,12,14,16,18,20,22,24,26,28,30,32].forEach((x, i) => tent(x, 19, 16 + (i * 7) % 12, i, 1.6));
  } else if (stage === 'polyp') {
    polyp();
  } else if (stage === 'budding') {
    polyp();
    shape(16, 15.5, 2.6, 2.6, true);
    put(15, 14, P.or); put(16, 14, P.or);
    put(12, 15, P.pink, 0.7);
    [[14,16],[14,17],[16,16],[16,17],[18,16]].forEach((p) => st(p[0], p[1]));
    shape(18.5, 2.6, 3, 2.6, true);
    put(18, 2, P.or);
    [[16,3],[16,4],[18,4],[18,5],[20,3],[20,4]].forEach((p, i) => st(p[0], p[1], i % 2 ? 0.6 : 1));
  } else if (stage === 'medusa') {
    shape(11, 10, 8.5, 8, true);
    for (let x = 0; x < 22; x++) {
      const k = x + ',10';
      if (base.has(k)) { if (x % 3 === 2) base.delete(k); else base.get(k).c = P.egg; }
    }
    put(10, 6, P.or); put(11, 6, P.or); put(10, 7, P.or); put(11, 7, P.or); put(9, 6, P.or); put(12, 7, P.or);
    put(6, 4, P.hi); put(7, 3, P.hi);
    for (let y = 11; y <= 15; y++) { put(10, y, P.neon, y % 2 ? 1 : 0.6); put(12, y, P.neon, y % 2 ? 0.6 : 1); }
    [4,6,8,14,16,18].forEach((x, i) => {
      const len = 7 + (i * 5) % 6;
      for (let k = 0; k < len; k++) st(x + (k > 3 && (k + i) % 4 === 0 ? 1 : 0), 11 + k, k % 2 ? 0.55 : 1);
    });
  } else if (stage === 'regrow') {
    for (let x = 6; x <= 16; x += 2) put(x, 2, P.gz, 0.45);
    put(5, 4, P.gz, 0.45); put(17, 4, P.gz, 0.45); put(4, 6, P.gz, 0.45); put(18, 6, P.gz, 0.45);
    for (let x = 5; x <= 17; x += 2) put(x, 7, P.gz, 0.45);
    [[9,10],[8,12],[7,14],[6,16],[5,18]].forEach((p) => put(p[0], p[1], P.gz, 0.6));
    shape(4.5, 21, 3.2, 1.6, false);
    put(4, 21, P.or);
    for (let x = 8; x <= 19; x += 2) put(x, 22, P.ind);
    stalk(15, 16, 15, 22);
    shape(16, 12.5, 2.8, 3, false);
    put(15, 12, P.or); put(16, 12, P.or);
    [[13,10],[12,9],[19,10],[20,9],[15,9],[17,9],[15,8]].forEach((p) => st(p[0], p[1]));
    stalk(20, 20, 19, 22);
    shape(20.5, 17.6, 1.5, 1.5, false);
    ground();
  } else {
    throw new Error('unknown sprite stage: ' + stage);
  }

  const map = mapCell(size);
  return { base: Array.from(base.values()).map(map), fa: fa.map(map), fb: fb.map(map) };
}

export const SPRITE_STAGES = ['hero', 'polyp', 'budding', 'medusa', 'regrow'];

/* ------------------------------------------------------------------ *
 * 2. the lifecycle animation — 39 frames of polyp -> medusa, then back
 *
 * frames[0..19]  grow: polyp shrinks away while the jellyfish rises
 * frames[20..38] revert: the jellyfish sinks and the polyp regrows
 * Each frame is { base, fa, fb, top } of the same cell shape as sprite().
 * ------------------------------------------------------------------ */
export function cycleFrames(size = 10) {
  const SZ = size, FLOOR = 59;
  const put = (L, x, y, c, o) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || x > 39 || y < 0 || y > FLOOR) return;
    L.set(x + ',' + y, { x, y, c, o: o == null ? 1 : o });
  };
  const shape = (L, cx, cy, rx, ry, dome) => {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      if (dome && y > cy) continue;
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) {
          const t = dome ? (y - (cy - ry)) / ry : (y - (cy - ry)) / (2 * ry);
          put(L, x, y, band(Math.max(0, Math.min(1, t)), x, y));
        }
      }
    }
  };
  const medusaK = (L, k, cy, tf) => {
    const cx = 20.5, s = 1 - tf;
    shape(L, cx, cy, 14.5 * k, 16 * k, true);
    const rim = Math.floor(cy);
    if (k > 0.45) for (let x = 0; x < 41; x++) {
      const key = x + ',' + rim;
      if (L.has(key)) { if (Math.abs(x - 20) % 4 === 2) L.delete(key); else L.get(key).c = P.egg; }
    }
    if (k > 0.8) [[11,6],[12,5],[13,5],[10,7],[11,7],[14,4]].forEach((p) => {
      const x = Math.round(20 + (p[0] - 20) * k), y = Math.round(cy + (p[1] - 18) * k);
      if (L.has(x + ',' + y)) put(L, x, y, P.hi);
    });
    const gx = 20, gy = cy - 7 * k, hw = Math.max(1.5, 2.5 * k), hh = Math.max(0.6, 1.5 * k);
    for (let y = Math.round(gy - hh); y < gy + hh; y++)
      for (let x = Math.round(gx - hw); x < gx + hw; x++) put(L, x, y, P.or);
    if (k > 0.7) for (let x = 19; x <= 21; x++) { put(L, x, gy - 2, P.or); put(L, x, gy + 2, P.or); }
    const tl = [8,10,12,14,16,18,20,22,24,26,28,30,32].map((x0, i) => [x0, 16 + (i * 7) % 12, i]);
    tl.forEach(([x0, L0, i]) => {
      const len = Math.round(L0 * Math.pow(1 - s, 1.2));
      const bx = 20 + (x0 - 20) * k;
      for (let j = 0; j < len; j++)
        put(L, bx + Math.round(Math.sin(j * 0.5 + i) * 1.6 * (j / len)), cy + 1 + j, P.neon, j % 2 ? 0.5 : 1);
    });
  };
  const medusa = (L, s) => medusaK(L, 1 - 0.72 * s, 18 + 40 * s, 1 - s);
  const polypAt = (L, u) => {
    shape(L, 20, FLOOR, 3, 1.4, true);
    const h = Math.round(2 + 12 * u), r = 1.4 + 2.2 * u;
    for (let y = FLOOR - h; y <= FLOOR; y++)
      for (let x = 19; x <= 20; x++)
        put(L, x, y, band(0.45 + 0.55 * (y - (FLOOR - h)) / Math.max(1, h), x, y));
    const hy = FLOOR - h - r + 1;
    shape(L, 20, hy, r, r, false);
    put(L, 19, hy, P.or); put(L, 20, hy, P.or);
    if (r > 2.5) { put(L, 19, hy - 1, P.or); put(L, 20, hy - 1, P.or); }
    const crown = [[-4,-3],[3,-3],[-1,-5],[1,-5],[-5,-4],[4,-4],[-1,-6],[1,-6],[-6,-5],[5,-5]];
    const n = Math.floor(u * crown.length), sc = r / 3.6;
    for (let i = 0; i < n; i++)
      put(L, 20 + crown[i][0] * sc + (crown[i][0] < 0 ? 0 : 0.5), hy + crown[i][1] * sc, P.neon, i % 2 ? 0.6 : 1);
    return hy;
  };

  const map = (c) => ({ l: (c.x * SZ) + 'px', t: (c.y * SZ) + 'px', s: (SZ - 1) + 'px', c: c.c, o: c.o });
  const pack = (L, T) => ({
    base: Array.from(L.values()).map(map), fa: [], fb: [], top: Array.from(T.values()).map(map)
  });

  const frames = [];
  const N = 20, ease = (t) => t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t);

  for (let f = 0; f < N; f++) {
    const L = new Map(), T = new Map(), g = f / (N - 1);
    const p = ease((g - 0.2) / 0.65), u = 1 - p;
    if (u > 0.06) polypAt(L, u);
    else if (p < 1) shape(L, 20, FLOOR, 2.2, 1, true);
    const e = ease((g - 0.08) / 0.92);
    if (e > 0) {
      const hy0 = 40;
      medusaK(L, 0.18 + 0.82 * e, hy0 - (hy0 - 18) * e, Math.pow(e, 1.5));
    }
    frames.push(pack(L, T));
  }
  // revert path: jellyfish sinks to the ground first, then the polyp grows up from there
  for (let f = 0; f <= 18; f++) {
    const L = new Map(), T = new Map();
    if (f <= 8) medusa(L, f / 8);
    else if (f <= 11) {
      const w = (f - 9) / 2;
      shape(L, 20, FLOOR, 4.2 - 1.2 * w, 3.2 - 0.8 * w, true);
      put(L, 19, FLOOR - 1, P.or); put(L, 20, FLOOR - 1, P.or);
    } else polypAt(L, (f - 11) / 7);
    frames.push(pack(L, T));
  }
  return frames;
}

/** The playback order the original site uses: grow, hold on the hero pose, revert, repeat. */
export function cycleSequence({ loops = 2, holdFrames = 27, leadIn = 3 } = {}) {
  const seq = [];
  const hold = (f, n) => { for (let i = 0; i < n; i++) seq.push(f); };
  const grow   = () => { for (let f = 0;  f <= 19; f++) seq.push(f); };
  const revert = () => { for (let f = 20; f <= 38; f++) seq.push(f); };
  for (let r = 0; r < loops; r++) { hold(0, leadIn); grow(); hold('H', holdFrames); revert(); }
  hold(0, leadIn); grow();
  return seq; // 'H' means "show the static hero sprite, idling"
}

/* ------------------------------------------------------------------ *
 * 3. background particle field (deterministic — same field every load)
 * ------------------------------------------------------------------ */
export function particles(n = 56) {
  let s = 31;
  const r = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const out = [];
  for (let i = 0; i < n; i++) {
    const big = r() < 0.2;
    out.push({
      l: Math.floor(r() * 66) * 10 + 'px',
      t: Math.floor(r() * 74) * 10 + 'px',
      s: big ? '6px' : '3px',
      c: r() < 0.15 ? P.neon : P.gz,
      o: (0.15 + r() * 0.4).toFixed(2)
    });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 4. logos
 * ------------------------------------------------------------------ */

/** 9x9 pixel wordmark glyph, as horizontal runs. `s` = pixel size in px. */
export function logoRuns(s = 3) {
  const rows = ['..ppppp..', '.pphpppp.', 'ppppopppp', 'mmmmmmmmm', 'iiiiiiiii', '.........', '.n.......', '..n......', '.n..nnnn.'];
  const C = { p: P.pink, h: P.hi, m: P.mid, i: P.ind, o: P.or, n: P.neon };
  const out = [];
  rows.forEach((r, y) => {
    let x = 0;
    while (x < r.length) {
      const ch = r[x];
      let e = x;
      while (e + 1 < r.length && r[e + 1] === ch) e++;
      if (C[ch]) out.push({ l: x * s + 'px', t: y * s + 'px', w: (e - x + 1) * s + 'px', h: s + 'px', c: C[ch] });
      x = e + 1;
    }
  });
  return { runs: out, w: rows[0].length * s + 'px', h: rows.length * s + 'px' };
}

/** The 7x7 nav mark, as an inline SVG string. `size` = rendered px (square). */
export function logoMarkSVG(size = 42) {
  return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 7 7" shape-rendering="crispEdges" aria-hidden="true">'
    + '<path style="fill:' + P.pink + '" d="M2 0h3v1H2zM1 1h5v1H1zM0 2h3v1H0zM4 2h3v1H4zM0 3h7v1H0z"/>'
    + '<path style="fill:' + P.or   + '" d="M3 2h1v1H3z"/>'
    + '<path style="fill:' + P.neon + '" d="M1 4h1v2H1zM3 4h1v3H3zM5 4h1v2H5z"/>'
    + '</svg>';
}

/* ------------------------------------------------------------------ *
 * 5. DOM mounting helpers — plain divs + spans, no framework
 * ------------------------------------------------------------------ */

const el = (tag, cls, style) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (style) n.setAttribute('style', style);
  return n;
};

function paint(host, cells) {
  host.textContent = '';
  const frag = document.createDocumentFragment();
  for (const c of cells) {
    frag.appendChild(el('span', null,
      'position:absolute;left:' + c.l + ';top:' + c.t + ';width:' + c.s + ';height:' + c.s +
      ';background:' + c.c + ';opacity:' + (c.o == null ? 1 : c.o)));
  }
  host.appendChild(frag);
}

const prefersReduced = () =>
  typeof window !== 'undefined' && window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Mount a still sprite with the idle tentacle sway + bob.
 * Returns { el, destroy }.
 */
export function mountSprite(container, stage = 'hero', size = 10, { motion = true } = {}) {
  const S = sprite(stage, size);
  const live = motion && !prefersReduced();
  const root = el('div', null, 'position:absolute;inset:0');
  const wrap = el('div', live ? 'tp-bob' : null, 'position:absolute;inset:0');
  const baseL = el('div', null, 'position:absolute;inset:0');
  const a = el('div', live ? 'tp-fa' : null, 'position:absolute;inset:0');
  const b = el('div', live ? 'tp-fb' : 'tp-fb-off', 'position:absolute;inset:0');
  paint(baseL, S.base); paint(a, S.fa); paint(b, S.fb);
  wrap.append(baseL, a, b);
  root.appendChild(wrap);
  if (!container.style.position) container.style.position = 'relative';
  container.appendChild(root);
  return { el: root, destroy: () => root.remove() };
}

/**
 * Mount the full lifecycle animation (the hero piece): the polyp grows into a
 * jellyfish, the jellyfish idles and bobs, then it sinks and the polyp regrows.
 * Give the container a size; 400x600 is the original hero box at size 10.
 * Returns { el, destroy }.
 */
export function mountJellyfish(container, {
  size = 10, motion = true, frameMs = 150, loops = 2, holdFrames = 27
} = {}) {
  const live = motion && !prefersReduced();
  const hero = sprite('hero', size);
  const root = el('div', null, 'position:absolute;inset:0');
  const wrap = el('div', null, 'position:absolute;inset:0');
  const baseL = el('div', null, 'position:absolute;inset:0');
  const a = el('div', null, 'position:absolute;inset:0');
  const b = el('div', null, 'position:absolute;inset:0');
  wrap.append(baseL, a, b);
  root.appendChild(wrap);
  if (!container.style.position) container.style.position = 'relative';
  container.appendChild(root);

  // the resting pose: static bell, bobbing, tentacles alternating between fa/fb
  const idle = (animate) => {
    wrap.className = animate ? 'tp-bob' : '';
    a.className = animate ? 'tp-fa' : '';
    b.className = animate ? 'tp-fb' : 'tp-fb-off';
    paint(baseL, hero.base); paint(a, hero.fa); paint(b, hero.fb);
  };

  if (!live) { idle(false); return { el: root, destroy: () => root.remove() }; }

  const frames = cycleFrames(size);
  const seq = cycleSequence({ loops, holdFrames });
  // turri desktop: start on the sequence's first frame - the polyp - not a flash of the grown hero before it.
  paint(baseL, frames[seq[0]].base);
  let pos = 0, iv = setInterval(() => {
    const prev = seq[pos];
    pos++;
    if (pos >= seq.length) { clearInterval(iv); iv = null; if (prev === 'H') return; }
    const step = pos < seq.length ? seq[pos] : 'H';
    if (prev === 'H' && step === 'H') return;
    if (step === 'H') { idle(true); return; }
    wrap.className = ''; a.className = ''; b.className = 'tp-fb-off';
    paint(baseL, frames[step].base); paint(a, []); paint(b, []);
  }, frameMs);

  return { el: root, destroy: () => { if (iv) clearInterval(iv); root.remove(); } };
}

/** Mount the drifting background particle field. */
export function mountParticles(container, n = 56) {
  const host = el('div', null, 'position:absolute;inset:0;pointer-events:none');
  paint(host, particles(n));
  container.style.position = container.style.position || 'relative';
  container.appendChild(host);
  return { el: host, destroy: () => host.remove() };
}

/** Mount the 9x9 pixel wordmark glyph. */
export function mountLogo(container, s = 3) {
  const L = logoRuns(s);
  const host = el('div', null, 'position:relative;width:' + L.w + ';height:' + L.h);
  for (const r of L.runs) {
    host.appendChild(el('span', null,
      'position:absolute;left:' + r.l + ';top:' + r.t + ';width:' + r.w + ';height:' + r.h + ';background:' + r.c));
  }
  container.appendChild(host);
  return { el: host, destroy: () => host.remove() };
}

/** Mount the 7x7 nav mark. */
export function mountLogoMark(container, size = 42) {
  const host = el('span', null, 'display:inline-flex;line-height:0');
  host.innerHTML = logoMarkSVG(size);
  container.appendChild(host);
  return { el: host, destroy: () => host.remove() };
}

/**
 * Mount the "intent cycle" diagram: four lit nodes on a dashed circle with a
 * little jelly orbiting them. `labels` are the four node captions.
 * Needs a 840x680 box (the original size).
 */
export function mountCycle(container, labels = ['define', 'review', 'regenerate', 'validate']) {
  container.style.position = container.style.position || 'relative';
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('width', '840'); svg.setAttribute('height', '680');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('style', 'position:absolute;inset:0');
  svg.innerHTML =
    '<circle cx="420" cy="330" r="200" fill="none" stroke="' + THEME.dim + '" stroke-width="4" stroke-dasharray="8 8"></circle>'
    + '<g style="fill:' + P.gz + '">'
    + '<g transform="translate(561 189) rotate(45)"><path d="M-5 -6 L5 0 L-5 6 Z"></path></g>'
    + '<g transform="translate(561 471) rotate(135)"><path d="M-5 -6 L5 0 L-5 6 Z"></path></g>'
    + '<g transform="translate(279 471) rotate(225)"><path d="M-5 -6 L5 0 L-5 6 Z"></path></g>'
    + '<g transform="translate(279 189) rotate(315)"><path d="M-5 -6 L5 0 L-5 6 Z"></path></g>'
    + '</g>';
  container.appendChild(svg);

  const orbit = el('div', 'tp-ohero', null);
  orbit.setAttribute('aria-hidden', 'true');
  orbit.appendChild(el('div', 'tp-jelly', null));
  container.appendChild(orbit);

  const pos = [[420, 130, '0s'], [620, 330, '-6s'], [420, 530, '-4s'], [220, 330, '-2s']];
  const lbl = [[484, 117, ''], [684, 317, ''], [484, 517, ''], [0, 317, 'width:156px;text-align:right']];
  pos.forEach((p, i) => {
    const n = el('div', 'tp-node tp-node-abs', 'left:' + p[0] + 'px;top:' + p[1] + 'px;animation-delay:' + p[2]);
    n.innerHTML = '<span style="font-size:36px;font-weight:500">' + (i + 1) + '</span>';
    container.appendChild(n);
    const L = el('div', 'tp-lbl', 'left:' + lbl[i][0] + 'px;top:' + lbl[i][1] + 'px;' + lbl[i][2]);
    L.innerHTML = '<span class="tp-nm">' + labels[i] + '</span>';
    container.appendChild(L);
  });
  return { el: container, destroy: () => { container.textContent = ''; } };
}

export default {
  PALETTE, THEME, SPRITE_STAGES, sprite, cycleFrames, cycleSequence, particles,
  logoRuns, logoMarkSVG, mountSprite, mountJellyfish, mountParticles, mountLogo,
  mountLogoMark, mountCycle
};
