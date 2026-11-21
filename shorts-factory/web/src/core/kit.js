// Reusable moving parts: the living backdrop, the camera, and the kinetic headline.
import { W, H, ctx, C, TAU, clamp, lerp, seg, eo, eob, spring, rnd, rgba,
         circle, rr, glow, HEAD_Y, KICK_Y } from './lib.js';

// ---------------------------------------------------------------- backdrop
// The two colour blooms are painted on a quarter-size offscreen canvas and
// scaled up. Four times fewer pixels, and the upscale blurs them for free —
// a real canvas blur filter costs ~10x more per frame.
const BW = 270, BH = 480;
let bc = null, bx = null, grain = null;

function ensure() {
  if (!bc) {
    bc = document.createElement('canvas'); bc.width = BW; bc.height = BH;
    bx = bc.getContext('2d');
  }
  if (!grain) {
    // One 128px noise tile, reused forever and offset each frame.
    grain = document.createElement('canvas'); grain.width = grain.height = 128;
    const g = grain.getContext('2d'), d = g.createImageData(128, 128);
    for (let i = 0; i < d.data.length; i += 4) {
      const v = 110 + Math.random() * 36;
      d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255;
    }
    g.putImageData(d, 0, 0);
  }
}

function bloom(x, y, r, color, alpha) {
  const g = bx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(color, alpha));
  g.addColorStop(0.55, rgba(color, alpha * 0.35));
  g.addColorStop(1, rgba(color, 0));
  bx.fillStyle = g; bx.fillRect(x - r, y - r, r * 2, r * 2);
}

/** Living background: drifting blooms + parallax bokeh + grain + vignette. */
export function backdrop(t, shotIndex) {
  ensure();
  bx.fillStyle = C.base; bx.fillRect(0, 0, BW, BH);

  // Three blooms on slow, mutually prime orbits so the field never repeats.
  const o = shotIndex * 1.7;
  bloom(BW * (0.30 + 0.16 * Math.sin(t * 0.21 + o)),
        BH * (0.26 + 0.09 * Math.cos(t * 0.17 + o)), BW * 0.95, C.a, 0.95);
  bloom(BW * (0.74 + 0.14 * Math.cos(t * 0.15 + o * 1.3)),
        BH * (0.62 + 0.11 * Math.sin(t * 0.13 + o)), BW * 0.85, C.b, 0.90);
  bloom(BW * (0.50 + 0.22 * Math.sin(t * 0.11 + o * 0.7)),
        BH * (0.88 + 0.06 * Math.cos(t * 0.19)), BW * 0.60, C.accent, 0.16);

  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(bc, 0, 0, W, H);

  // Bokeh: three depth layers rising at different speeds (parallax).
  for (let layer = 0; layer < 3; layer++) {
    const n = [14, 10, 7][layer];
    const speed = [10, 20, 34][layer];
    const size = [5, 11, 22][layer];
    const al = [0.16, 0.12, 0.08][layer];
    for (let i = 0; i < n; i++) {
      const s = layer * 100 + i;
      const x = rnd(s) * W + Math.sin(t * 0.3 + s) * 26;
      const y = (H + 120) - ((rnd(s + 7) * H + t * speed) % (H + 240));
      const r = size * (0.6 + rnd(s + 3) * 0.9);
      const tw = 0.7 + 0.3 * Math.sin(t * 1.6 + s * 2.1);
      circle(x, y, r, rgba(i % 4 === 0 ? C.accent : C.white, al * tw));
    }
  }

  // Grain, then vignette.
  ctx.save();
  ctx.globalAlpha = 0.045; ctx.globalCompositeOperation = 'overlay';
  const ox = -(t * 61 % 128), oy = -(t * 97 % 128);
  const pat = ctx.createPattern(grain, 'repeat');
  ctx.translate(ox, oy); ctx.fillStyle = pat; ctx.fillRect(0, 0, W + 128, H + 128);
  ctx.restore();

  const v = ctx.createRadialGradient(W / 2, H * 0.46, H * 0.22, W / 2, H * 0.5, H * 0.78);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.62)');
  ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
}

// ---------------------------------------------------------------- headline
// The beat's 2-5 word overlay. Words drop in on a spring with a stagger, then
// an accent rule wipes out underneath. This is most of the perceived "motion".
function fitFont(words, maxW, start) {
  for (let size = start; size > 44; size -= 6) {
    ctx.font = `900 ${size}px Inter, 'Liberation Sans', 'DejaVu Sans', sans-serif`;
    const sp = size * 0.26;
    const total = words.reduce((a, w) => a + ctx.measureText(w).width, 0) + sp * (words.length - 1);
    if (total <= maxW) return { size, sp, total };
    if (words.length > 2) {   // try two lines before shrinking much further
      let best = null;
      for (let i = 1; i < words.length; i++) {
        const A = words.slice(0, i), B = words.slice(i);
        const wa = A.reduce((a, w) => a + ctx.measureText(w).width, 0) + sp * (A.length - 1);
        const wb = B.reduce((a, w) => a + ctx.measureText(w).width, 0) + sp * (B.length - 1);
        const m = Math.max(wa, wb);
        if (!best || m < best.m) best = { m, rows: [A, B] };
      }
      if (best && best.m <= maxW) return { size, sp, rows: best.rows };
    }
  }
  return { size: 48, sp: 12 };
}

export function headline(text, lt, d) {
  const words = String(text || '').toUpperCase().split(/\s+/).filter(Boolean);
  if (!words.length) return;

  const maxW = W * 0.84;
  const f = fitFont(words, maxW, 132);
  const rows = f.rows || [words];
  const lh = f.size * 1.08;
  const y0 = HEAD_Y - (rows.length - 1) * lh / 2;

  ctx.font = `900 ${f.size}px Inter, 'Liberation Sans', 'DejaVu Sans', sans-serif`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';

  let k = 0, lowest = y0;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const widths = row.map((w) => ctx.measureText(w).width);
    const rowW = widths.reduce((a, b) => a + b, 0) + f.sp * (row.length - 1);
    let x = (W - rowW) / 2;
    const y = y0 + r * lh;
    lowest = y;
    for (let i = 0; i < row.length; i++) {
      const delay = 0.07 + k * 0.055;
      const p = spring(clamp((lt - delay) / 0.55));
      const out = 1 - seg(lt, d - 0.22, d);          // leave slightly before the cut
      const al = clamp(seg(lt, delay, delay + 0.16)) * out;
      if (al > 0.002) {
        ctx.save();
        ctx.globalAlpha = al;
        ctx.translate(x + widths[i] / 2, y + (1 - p) * 56);
        const s = lerp(0.82, 1, p);
        ctx.scale(s, s);
        ctx.lineWidth = f.size * 0.17; ctx.strokeStyle = C.ink;
        ctx.strokeText(row[i], -widths[i] / 2, 0);
        ctx.fillStyle = C.white;
        ctx.fillText(row[i], -widths[i] / 2, 0);
        ctx.restore();
      }
      x += widths[i] + f.sp; k++;
    }
  }

  // Accent rule wiping out under the headline.
  const wipe = eo(clamp(seg(lt, 0.26 + k * 0.03, 0.95 + k * 0.03)));
  const fade = 1 - seg(lt, d - 0.22, d);
  if (wipe > 0.01 && fade > 0.01) {
    const bw = 210 * wipe, bh = 11;
    ctx.globalAlpha = fade;
    rr((W - bw) / 2, lowest + f.size * 0.74, bw, bh, bh, C.accent);
    ctx.globalAlpha = 1;
  }
}

// ---------------------------------------------------------------- chrome
/** Thin progress rail at the top — tells the viewer how much is left. */
export function progress(t, dur) {
  const pad = 86, y = 132, h = 9;
  rr(pad, y, W - pad * 2, h, h, rgba(C.white, 0.16));
  rr(pad, y, (W - pad * 2) * clamp(t / dur), h, h, rgba(C.accent, 0.95));
}

/** Small drifting kicker naming the subject of the beat. */
export function kicker(text, lt, d) {
  const s = String(text || '').toUpperCase().slice(0, 44);
  if (!s) return;
  const al = clamp(seg(lt, 0.30, 0.62)) * (1 - seg(lt, d - 0.25, d));
  if (al <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = al * 0.8;
  ctx.font = `700 34px Inter, 'Liberation Sans', 'DejaVu Sans', sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.letterSpacing = '4px';
  const w = ctx.measureText(s).width;
  const rise = lerp(10, 0, eo(clamp(seg(lt, 0.30, 0.70))));
  rr((W - w) / 2 - 26, KICK_Y - 28 + rise, w + 52, 56, 28, rgba(C.white, 0.10));
  ctx.fillStyle = rgba(C.white, 0.92);
  ctx.fillText(s, W / 2, KICK_Y + rise);
  ctx.letterSpacing = '0px';
  ctx.restore();
}
