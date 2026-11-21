// Canvas, palette, easing and drawing primitives. Everything else imports from here.
export const W = 1080, H = 1920;

// Vertical layout bands. Nothing may stray into the caption zone.
// The camera scales everything inside it by up to ~1.15 about y=H*0.52, so the
// scene's drawn bounds sit higher than its on-screen bounds. These values keep
// the scene clear of the caption zone even at full punch-in.
export const HEAD_Y = 390;    // kinetic headline centre
export const KICK_Y = 600;    // kicker pill centre
export const SCENE_Y = 980;   // animated scene centre
export const SCENE_R = 270;   // scene half-HEIGHT (the tight constraint)
export const SCENE_W = 430;   // scene half-WIDTH (plenty of room sideways)
export const CAP_TOP = 1330;  // captions grow DOWN from here (clear of the Shorts UI)

export let ctx = null;
export function setCtx(c) { ctx = c; }

// ---------- math ----------
export const TAU = Math.PI * 2;
export const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const seg = (t, a, b) => clamp((t - a) / ((b - a) || 1e-6));
export const eo = (t) => 1 - Math.pow(1 - t, 3);                 // ease out cubic
export const ei = (t) => t * t * t;                               // ease in cubic
export const eio = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const eob = (t) => { const c1 = 1.70158, c3 = c1 + 1;      // overshoot
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
export const spring = (t) => t >= 1 ? 1 :                         // damped settle
  1 - Math.pow(2, -9 * t) * Math.cos(t * 13);
export const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
export const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++)
  { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return Math.abs(h); };

// ---------- palettes ----------
// base: deep background. a/b: the two light blooms. accent: the one loud colour.
export const PALETTES = [
  { base: '#070b18', a: '#1b2a6b', b: '#3a1a66', accent: '#ffc83d', accent2: '#7aa2ff', name: 'midnight' },
  { base: '#04120f', a: '#0d4a46', b: '#13613f', accent: '#5af0be', accent2: '#c7f26a', name: 'mint' },
  { base: '#160610', a: '#6b1636', b: '#8c2140', accent: '#ff8096', accent2: '#ffd36e', name: 'ember' },
  { base: '#050d16', a: '#123a68', b: '#0f5b73', accent: '#68c6ff', accent2: '#b9f0ff', name: 'arctic' },
  { base: '#140a04', a: '#5c3012', b: '#7a3a12', accent: '#ffaa5a', accent2: '#ffe08a', name: 'amber' },
  { base: '#0b0618', a: '#3c1a7a', b: '#5a2470', accent: '#c68cff', accent2: '#7df0ff', name: 'ultra' },
  { base: '#061208', a: '#1b4a2a', b: '#2f6b24', accent: '#a0f078', accent2: '#ffe96b', name: 'moss' },
];

export const C = { base: '#070b18', a: '#1b2a6b', b: '#3a1a66',
                   accent: '#ffc83d', accent2: '#7aa2ff', ink: '#05060a', white: '#ffffff' };

export function setTheme(seed) {
  const p = PALETTES[seed % PALETTES.length];
  Object.assign(C, p);
  return p;
}

/** '#rrggbb' + alpha -> 'rgba(...)'. Cached, because this runs thousands of times. */
const _rgba = new Map();
export function rgba(hex, alpha) {
  const k = hex + '|' + alpha;
  let v = _rgba.get(k);
  if (v) return v;
  const n = parseInt(hex.slice(1), 16);
  v = `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
  _rgba.set(k, v);
  return v;
}

// ---------- primitives ----------
export function circle(x, y, r, fill) {
  if (!(r > 0)) return;          // easings can undershoot; arc() throws on r < 0
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = fill; ctx.fill();
}
export function ring(x, y, r, width, stroke, from = 0, to = TAU) {
  if (!(r > 0) || !(width > 0)) return;
  ctx.beginPath(); ctx.arc(x, y, r, from, to);
  ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.stroke();
}
export function rr(x, y, w, h, r, fill) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fillStyle = fill; ctx.fill();
}
export function poly(pts, stroke, width) {
  ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.strokeStyle = stroke; ctx.lineWidth = width;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
}
/** Soft glowing dot — a radial gradient, no canvas blur filter (far too slow per frame). */
export function glow(x, y, r, color, alpha = 1) {
  if (!(r > 0)) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(color, 0.85 * alpha));
  g.addColorStop(0.45, rgba(color, 0.28 * alpha));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
}
