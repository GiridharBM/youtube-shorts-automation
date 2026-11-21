// Word-synced captions, drawn on the canvas (so no libass, no .ass file, and
// full control over the animation). Chunks of 2-3 words; the word actually
// being spoken right now is the accent-coloured one.
import { W, CAP_TOP, ctx, C, clamp, lerp, seg, eob, rgba, rr } from './lib.js';
import { T } from './timing.js';

const MAXW = W * 0.88, SIZE = 108, PER = 3;
let caps = [];

export function buildCaptions() {
  caps = [];
  for (let i = 0; i < T.lines.length; i++) {
    const ws = T.words.filter((w) => w.line === i);
    for (let k = 0; k < ws.length;) {
      // Avoid a lonely trailing word, and break early on sentence punctuation.
      let n = Math.min(PER, ws.length - k);
      if (ws.length - k === PER + 1) n = 2;
      for (let j = 0; j < n; j++) {
        if (/[.!?,]$/.test(ws[k + j].w) && j + 1 < n) { n = j + 1; break; }
      }
      const group = ws.slice(k, k + n);
      caps.push({
        line: i,
        s: group[0].s - 0.06,
        e: group[group.length - 1].e + 0.10,
        words: group.map((w) => ({ txt: w.w.replace(/[",]/g, '').toUpperCase(), s: w.s, e: w.e })),
      });
      k += n;
    }
  }
  // Hold each chunk until the next one starts, so nothing flickers off.
  caps.forEach((c, k) => {
    const next = caps[k + 1];
    if (next) c.e = next.line === c.line ? next.s : Math.min(next.s, c.e + 0.30);
    c.e = Math.max(c.e, c.s + 0.26);
  });
  return caps;
}

export const captionList = () => caps;

export function drawCaption(t) {
  const c = caps.find((x) => t >= x.s && t < x.e);
  if (!c) return;
  const lt = t - c.s;

  ctx.save();
  ctx.font = `900 ${SIZE}px Inter, 'Liberation Sans', 'DejaVu Sans', sans-serif`;
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.lineJoin = 'round';
  ctx.letterSpacing = '-2px';

  const sp = SIZE * 0.26;
  for (const w of c.words) w.m = ctx.measureText(w.txt).width;
  const width = (ws) => ws.reduce((a, w) => a + w.m, 0) + sp * (ws.length - 1);

  let rows = [c.words];
  if (width(c.words) > MAXW && c.words.length > 1) {
    let best = null;
    for (let i = 1; i < c.words.length; i++) {
      const A = c.words.slice(0, i), B = c.words.slice(i);
      const m = Math.max(width(A), width(B));
      if (!best || m < best.m) best = { m, rows: [A, B] };
    }
    rows = best.rows;
  }
  const fit = Math.min(1, MAXW / Math.max(...rows.map(width)));
  const pop = lt < 0.18 ? lerp(0.70, 1, eob(seg(lt, 0, 0.18))) : 1;

  // Anchor the block by its TOP edge: a two-row caption grows downward instead
  // of pushing its first row up into the scene.
  ctx.translate(W / 2, CAP_TOP);
  ctx.scale(pop * fit, pop * fit);

  const lh = SIZE * 1.02, y0 = 0;
  rows.forEach((row, ri) => {
    let x = -width(row) / 2;
    const y = y0 + ri * lh;
    for (const w of row) {
      const live = t >= w.s && t < w.e + 0.05;
      const s = live ? 1.06 : 1;
      ctx.save();
      ctx.translate(x + w.m / 2, y);
      ctx.scale(s, s);
      ctx.lineWidth = 26; ctx.strokeStyle = C.ink;
      ctx.strokeText(w.txt, -w.m / 2, 6);
      ctx.strokeText(w.txt, -w.m / 2, 0);
      ctx.fillStyle = live ? C.accent : C.white;
      ctx.fillText(w.txt, -w.m / 2, 0);
      ctx.restore();
      x += w.m + sp;
    }
  });

  ctx.letterSpacing = '0px';
  ctx.restore();
}
