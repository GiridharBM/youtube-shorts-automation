// One animated scene per beat, drawn around (W/2, SCENE_Y).
// Every scene is a pure function of local shot time, so any frame can be
// re-rendered on its own — that is what makes frame-by-frame capture possible.
import { W, SCENE_Y, SCENE_R, SCENE_W, ctx, C, TAU, clamp, lerp, seg, eo, eob, eio,
         spring, rnd, rgba, circle, ring, rr, poly, glow } from './core/lib.js';

const CX = W / 2, CY = SCENE_Y;

// ---------------------------------------------------------------- orbit
function orbit(lt, d, s) {
  const in_ = eo(clamp(lt / 0.7));
  glow(CX, CY, SCENE_R * 1.5 * in_, C.accent, 0.55);
  for (let r = 0; r < 3; r++) {
    const rad = (100 + r * 80) * in_;
    ring(CX, CY, rad, 4, rgba(C.white, 0.20 + r * 0.04));
  }
  circle(CX, CY, 52 * spring(clamp(lt / 0.6)), C.white);
  circle(CX, CY, 34 * spring(clamp(lt / 0.6)), C.accent);
  for (let i = 0; i < 6; i++) {
    const rad = (100 + (i % 3) * 80) * in_;
    const sp = 0.5 + (i % 3) * 0.22 + rnd(s.seed + i) * 0.18;
    const a = lt * sp + i * (TAU / 6) + s.seed;
    const x = CX + Math.cos(a) * rad, y = CY + Math.sin(a) * rad * 0.92;
    const hero = i === 1;
    for (let k = 1; k <= 5; k++) {          // motion trail
      const ta = a - k * 0.07;
      circle(CX + Math.cos(ta) * rad, CY + Math.sin(ta) * rad * 0.92,
             (hero ? 17 : 11) * (1 - k / 6), rgba(hero ? C.accent : C.accent2, 0.13 * (1 - k / 6)));
    }
    if (hero) glow(x, y, 54, C.accent, 0.9);
    circle(x, y, (hero ? 26 : 17) * in_, hero ? C.accent : C.accent2);
  }
}

// ---------------------------------------------------------------- bars
function bars(lt, d, s) {
  const n = 5, gap = 40, bw = (SCENE_W * 2 - gap * 4) / n, baseY = CY + SCENE_R * 0.80;
  const x0 = CX - (n * bw + (n - 1) * gap) / 2;
  const hero = 3;
  poly([[x0 - 30, baseY + 4], [x0 + n * bw + (n - 1) * gap + 30, baseY + 4]], rgba(C.white, 0.22), 4);
  for (let i = 0; i < n; i++) {
    const target = (0.30 + rnd(s.seed + i) * 0.5 + (i === hero ? 0.46 : 0)) * SCENE_R * 1.45;
    const p = eob(clamp(seg(lt, 0.12 + i * 0.09, 0.95 + i * 0.09)));
    const breathe = 1 + 0.018 * Math.sin(lt * 2.2 + i);
    const h = Math.max(6, target * p * breathe);
    const x = x0 + i * (bw + gap);
    if (i === hero) glow(x + bw / 2, baseY - h, 120, C.accent, 0.8 * clamp(p));
    rr(x, baseY - h, bw, h, 20, i === hero ? C.accent : rgba(C.white, 0.40));
    if (i === hero && p > 0.8) circle(x + bw / 2, baseY - h - 34, 11 * clamp((p - 0.8) * 5), C.accent);
  }
}

// ---------------------------------------------------------------- radar
function radar(lt, d, s) {
  ring(CX, CY, SCENE_R * 0.95, 5, rgba(C.white, 0.24));
  ring(CX, CY, SCENE_R * 0.62, 5, rgba(C.white, 0.18));
  ring(CX, CY, SCENE_R * 0.30, 5, rgba(C.white, 0.15));
  for (let i = 0; i < 3; i++) {                    // outward pulses
    const p = ((lt * 0.55 + i / 3) % 1);
    ring(CX, CY, SCENE_R * p, 9 * (1 - p), rgba(C.accent, 0.75 * (1 - p)));
  }
  const a = lt * 1.25;                              // sweep
  ctx.save();
  ctx.translate(CX, CY); ctx.rotate(a);
  const g = ctx.createLinearGradient(0, 0, SCENE_R, 0);
  g.addColorStop(0, rgba(C.accent, 0.35)); g.addColorStop(1, rgba(C.accent, 0));
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, SCENE_R, -0.42, 0); ctx.closePath();
  ctx.fillStyle = g; ctx.fill();
  ctx.restore();
  poly([[CX, CY], [CX + Math.cos(a) * SCENE_R, CY + Math.sin(a) * SCENE_R]], rgba(C.accent, 0.95), 5);
  for (let i = 0; i < 4; i++) {                     // blips that light as the sweep passes
    const ba = s.seed + i * 1.9, br = SCENE_R * (0.35 + rnd(s.seed + i) * 0.55);
    const x = CX + Math.cos(ba) * br, y = CY + Math.sin(ba) * br;
    const since = ((a - ba) % TAU + TAU) % TAU;
    const hot = Math.exp(-since * 1.6);
    circle(x, y, 9 + 9 * hot, rgba(C.accent2, 0.3 + 0.7 * hot));
  }
  circle(CX, CY, 22, C.white);
}

// ---------------------------------------------------------------- wave
function wave(lt, d, s) {
  for (let k = 2; k >= 0; k--) {
    const amp = (48 + k * 34) * (0.8 + 0.2 * Math.sin(lt * 1.3 + k));
    const pts = [];
    for (let x = -SCENE_W; x <= SCENE_W; x += 16) {
      const e = clamp((x + SCENE_W) / (SCENE_W * 2));
      const reveal = clamp(seg(lt, 0.1 + k * 0.08, 0.9 + k * 0.08));
      if (e > reveal) break;
      const env = Math.sin(e * Math.PI);
      pts.push([CX + x, CY + Math.sin(e * 7 - lt * (2.1 + k * 0.5) + k) * amp * env + (k - 1) * 58]);
    }
    if (pts.length > 1) poly(pts, k === 1 ? C.accent : rgba(C.accent2, 0.55 - k * 0.09), k === 1 ? 16 : 9);
  }
  const e = 0.5 + 0.42 * Math.sin(lt * 1.1);
  const y = CY + Math.sin(e * 7 - lt * 2.6 + 1) * 60 * Math.sin(e * Math.PI);
  glow(CX + (e * 2 - 1) * SCENE_W, y, 110, C.accent, 1);
  circle(CX + (e * 2 - 1) * SCENE_W, y, 21, C.white);
}

// ---------------------------------------------------------------- dot grid
function dotgrid(lt, d, s) {
  const cols = 11, rows = 7, sx = (SCENE_W * 2) / (cols - 1), sy = (SCENE_R * 1.7) / (rows - 1);
  const x0 = CX - (cols - 1) * sx / 2, y0 = CY - (rows - 1) * sy / 2;
  const head = ((lt * 0.48) % 1.35) * (cols + rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const appear = clamp(seg(lt, 0.05 + (c + r) * 0.012, 0.45 + (c + r) * 0.012));
      const dist = Math.abs((c + r) - head);
      const hot = Math.exp(-dist * dist / 3.2);
      const rad = (7 + 16 * hot) * eo(appear);
      if (hot > 0.55) glow(x0 + c * sx, y0 + r * sy, rad * 3.2, C.accent, (hot - 0.55) * 1.6);
      circle(x0 + c * sx, y0 + r * sy, rad,
             rgba(hot > 0.35 ? C.accent : C.white, (0.30 + 0.70 * hot) * appear));
    }
  }
}

// ---------------------------------------------------------------- flow
function flow(lt, d, s) {
  const n = 3, span = SCENE_W * 1.74;
  const xs = Array.from({ length: n }, (_, i) => CX - span / 2 + (span / (n - 1)) * i);
  const ys = xs.map((_, i) => CY + (i === 1 ? -62 : 42));
  for (let i = 0; i < n - 1; i++) {
    const p = clamp(seg(lt, 0.25 + i * 0.5, 0.85 + i * 0.5));
    poly([[xs[i], ys[i]], [lerp(xs[i], xs[i + 1], p), lerp(ys[i], ys[i + 1], p)]],
         rgba(C.white, 0.42), 11);
  }
  const trip = (lt * 0.55) % 1;                       // packet running the path
  const legF = trip * (n - 1), leg = Math.min(n - 2, Math.floor(legF)), f = legF - leg;
  const px = lerp(xs[leg], xs[leg + 1], f), py = lerp(ys[leg], ys[leg + 1], f);
  glow(px, py, 110, C.accent, 1);
  circle(px, py, 24, C.accent);
  for (let i = 0; i < n; i++) {
    const pop = spring(clamp(seg(lt, 0.08 + i * 0.42, 0.68 + i * 0.42)));
    const near = Math.exp(-Math.pow((legF - i) * 2.6, 2));
    const r = (62 + 16 * near) * pop;
    if (near > 0.3) glow(xs[i], ys[i], r * 2.4, C.accent, near * 0.8);
    ring(xs[i], ys[i], r, 9, rgba(C.white, 0.6));
    circle(xs[i], ys[i], Math.max(0, r - 16), rgba(near > 0.4 ? C.accent : C.accent2, 0.45 + 0.55 * near));
  }
}

// ---------------------------------------------------------------- counter
function counter(lt, d, s) {
  const target = s.number ?? Math.round(40 + rnd(s.seed) * 300);
  const p = eo(clamp(seg(lt, 0.12, Math.min(d * 0.62, 1.9))));
  const shown = Math.round(target * p);
  ring(CX, CY, SCENE_R * 0.82, 14, rgba(C.white, 0.14));
  ring(CX, CY, SCENE_R * 0.82, 14, C.accent, -Math.PI / 2, -Math.PI / 2 + TAU * p);
  glow(CX, CY, SCENE_R * 1.1, C.accent, 0.35);
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const bump = 1 + 0.03 * Math.sin(lt * 9) * (p < 1 ? 1 : 0);
  ctx.font = `900 ${Math.round(150 * bump)}px Inter, 'Liberation Sans', sans-serif`;
  ctx.lineWidth = 22; ctx.lineJoin = 'round'; ctx.strokeStyle = C.ink;
  const txt = String(shown) + (s.suffix || '');
  ctx.strokeText(txt, CX, CY); ctx.fillStyle = C.white; ctx.fillText(txt, CX, CY);
  ctx.restore();
}

// ---------------------------------------------------------------- split
function split(lt, d, s) {
  const gap = 38, pw = SCENE_W - gap / 2, ph = SCENE_R * 1.5;
  const p = eo(clamp(seg(lt, 0.08, 0.72)));
  const lx = CX - gap / 2 - pw + (1 - p) * -420;
  const rx = CX + gap / 2 + (1 - p) * 420;
  rr(lx, CY - ph / 2, pw, ph, 34, rgba(C.white, 0.14));
  rr(rx, CY - ph / 2, pw, ph, 34, rgba(C.accent, 0.20));
  circle(lx + pw / 2, CY - ph * 0.14, 52 * p, rgba(C.white, 0.55));
  circle(rx + pw / 2, CY - ph * 0.14, 52 * p * (1 + 0.06 * Math.sin(lt * 3)), C.accent);
  for (let i = 0; i < 3; i++) {
    const w = pw * (0.62 - i * 0.12), y = CY + ph * 0.10 + i * 40;
    const a = clamp(seg(lt, 0.5 + i * 0.12, 0.9 + i * 0.12));
    rr(lx + (pw - w) / 2, y, w * a, 13, 7, rgba(C.white, 0.30));
    rr(rx + (pw - w) / 2, y, w * a, 13, 7, rgba(C.accent, 0.55));
  }
  const vp = clamp(seg(lt, 0.3, 0.9));
  poly([[CX, CY - ph / 2 - 26], [CX, CY - ph / 2 - 26 + (ph + 52) * vp]], rgba(C.white, 0.35), 4);
}

// ---------------------------------------------------------------- burst
function burst(lt, d, s) {
  const n = 18;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + s.seed * 0.3 + lt * 0.12;
    const p = eo(clamp(seg(lt, 0.05 + (i % 6) * 0.045, 0.75 + (i % 6) * 0.045)));
    const r0 = 74, r1 = SCENE_R * (0.72 + rnd(s.seed + i) * 0.35);
    const pulse = 1 + 0.07 * Math.sin(lt * 2.4 + i * 0.6);
    poly([[CX + Math.cos(a) * r0, CY + Math.sin(a) * r0],
          [CX + Math.cos(a) * (r0 + (r1 - r0) * p * pulse), CY + Math.sin(a) * (r0 + (r1 - r0) * p * pulse)]],
         rgba(i % 3 === 0 ? C.accent : C.accent2, 0.35 + 0.6 * p), i % 3 === 0 ? 13 : 7);
  }
  const rp = (lt * 0.42) % 1;
  ring(CX, CY, 74 + rp * SCENE_R * 0.9, 7 * (1 - rp), rgba(C.accent, 0.6 * (1 - rp)));
  glow(CX, CY, 180, C.accent, 0.7);
  circle(CX, CY, 56 * spring(clamp(lt / 0.5)), C.white);
}

// ---------------------------------------------------------------- stack
function stack(lt, d, s) {
  const n = 4, cw = SCENE_W * 1.80, ch = 108;
  for (let i = 0; i < n; i++) {
    const p = eob(clamp(seg(lt, 0.10 + i * 0.16, 0.80 + i * 0.16)));
    if (p <= 0.001) continue;
    const y = CY + SCENE_R * 0.62 - i * (ch + 20) - (1 - p) * 180;
    const rot = (rnd(s.seed + i) - 0.5) * 0.045 * (1 - p * 0.6);
    const float = Math.sin(lt * 1.5 + i * 0.8) * 4;
    ctx.save();
    ctx.globalAlpha = clamp(p * 1.3);
    ctx.translate(CX, y + float); ctx.rotate(rot);
    rr(-cw / 2, -ch / 2, cw, ch, 24, i === n - 1 ? C.accent : rgba(C.white, 0.17));
    circle(-cw / 2 + 56, 0, 20, i === n - 1 ? rgba(C.ink, 0.55) : rgba(C.accent, 0.8));
    rr(-cw / 2 + 96, -11, cw * (0.34 + rnd(s.seed + i) * 0.26), 22, 11,
       i === n - 1 ? rgba(C.ink, 0.35) : rgba(C.white, 0.28));
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------- choosing
const ALL = [orbit, bars, radar, wave, dotgrid, flow, counter, split, burst, stack];
const BY_NAME = { orbit, bars, radar, wave, dotgrid, flow, counter, split, burst, stack };

const NUM = /(\d[\d,.]*)\s*(%|x|×)?/;
const WORD_NUM = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
};

/** Pick a scene for a beat: content first, then spread so the video never
 *  shows the same scene twice until every other one has had a turn. */
export function sceneFor(line, i, seed, prev, used = new Set()) {
  const text = `${line.overlay || ''} ${line.text || ''}`;
  const low = text.toLowerCase();
  let fn = null, number = null, suffix = '';

  const m = (line.overlay || '').match(NUM) || (line.text || '').match(NUM);
  if (m) {
    const v = parseFloat(m[1].replace(/,/g, ''));
    if (isFinite(v) && v > 1 && v < 100000) { number = Math.round(v); suffix = m[2] || ''; fn = counter; }
  }
  if (!fn) {
    const w = low.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)\b/);
    if (w && WORD_NUM[w[1]] > 2) { number = WORD_NUM[w[1]]; fn = counter; }
  }
  if (!fn && /\b(vs|versus|but|instead|unlike|while|whereas|more than|less than|compared)\b/.test(low)) fn = split;
  if (!fn && /\b(first|then|next|step|process|becomes|turns into|leads to|chain|sends?)\b/.test(low)) fn = flow;
  if (!fn && /\b(wave|sound|light|signal|heat|pulse|vibrat|frequency|energy)\b/.test(low)) fn = wave;
  if (!fn && /\b(search|find|detect|hidden|secret|scan|look)\b/.test(low)) fn = radar;
  if (!fn && /\b(grow|rise|fall|drop|increase|double|percent|most|rate)\b/.test(low)) fn = bars;
  if (!fn && /\b(explode|burst|release|escape|spread|shock|blast)\b/.test(low)) fn = burst;

  if (!fn || fn === prev || used.has(fn)) {
    let pool = ALL.filter((f) => f !== prev && f !== counter && !used.has(f));
    if (!pool.length) { used.clear(); pool = ALL.filter((f) => f !== prev && f !== counter); }
    fn = pool[(seed + i * 7) % pool.length];
  }
  used.add(fn);
  return { fn, number, suffix, seed: (seed % 97) + i * 1.7, i };
}

export { BY_NAME };
