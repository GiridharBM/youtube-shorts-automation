// Boot: fonts -> timing -> captions -> shots. Then draw(t) renders film time t
// as a pure function of t. window.OP is the API tools/capture.mjs drives.
import { W, H, setCtx, ctx, C, clamp, seg, eo, eio, hash, setTheme,
         setThemeByName, rgba } from './core/lib.js';
import { T, loadTiming } from './core/timing.js';
import { buildCaptions, drawCaption, captionList } from './core/captions.js';
import { backdrop, headline, kicker, progress } from './core/kit.js';
import { sceneFor } from './scenes.js';

const cv = document.getElementById('cv');
setCtx(cv.getContext('2d', { alpha: false }));
const OP = (window.OP = { ready: false });

function draw(t) {
  t = clamp(t, 0, Math.max(0.001, T.dur - 1e-4));

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1; ctx.letterSpacing = '0px';
  ctx.fillStyle = C.base; ctx.fillRect(0, 0, W, H);

  // which beat are we in
  const S = OP._shots;
  let i = S.length - 1;
  while (i > 0 && S[i].at > t) i--;
  const sh = S[i], d = sh.end - sh.at, lt = t - sh.at;

  backdrop(t, i);

  // Camera: a hard punch-in on the cut that settles, plus a slow push across
  // the whole beat. Keeps the frame alive even when the scene is calm.
  const punch = 1 + 0.085 * (1 - eo(clamp(lt / 0.42)));
  const drift = 1 + 0.055 * eio(clamp(lt / d));
  const sway = Math.sin(t * 0.37 + i) * 9;
  ctx.save();
  ctx.translate(W / 2 + sway, H * 0.52);
  ctx.scale(punch * drift, punch * drift);
  ctx.translate(-W / 2, -H * 0.52);

  sh.scene.fn(lt, d, sh.scene);
  headline(sh.line.overlay, lt, d);
  kicker(sh.line.visual, lt, d);

  ctx.restore();

  // Cut flash.
  if (i > 0 && lt < 0.14) {
    ctx.fillStyle = C.white;
    ctx.globalAlpha = 0.40 * (1 - lt / 0.14);
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }

  progress(t, T.dur);
  drawCaption(t);

  // Fade from / to black.
  const fade = Math.min(clamp(t / 0.30), clamp((T.dur - t) / 0.40));
  if (fade < 1) {
    ctx.fillStyle = '#000'; ctx.globalAlpha = 1 - fade;
    ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
  }
}

(async () => {
  try {
    try { await document.fonts.load('900 120px Inter'); } catch {}
    await document.fonts.ready;

    await loadTiming();
    buildCaptions();

    const seed = hash(String(T.lines.map((l) => l.text).join('|')).slice(0, 120));
    // `style` comes from the workflow input; "auto" hashes the topic instead,
    // so the same topic always looks the same.
    const theme = setThemeByName(T.style, seed);

    let prev = null;
    const used = new Set();
    OP._shots = T.lines.map((line, i) => {
      const scene = sceneFor(line, i, seed, prev, used);
      prev = scene.fn;
      return {
        id: `b${i}`, at: line.start, end: i + 1 < T.lines.length ? T.lines[i + 1].start : T.dur,
        line, scene,
      };
    });

    OP.duration = () => T.dur;
    OP.theme = () => theme.name;
    OP.draw = draw;
    OP.frame = (t, q = 0.93) => { draw(t); return cv.toDataURL('image/jpeg', q); };
    OP.shots = () => OP._shots.map((s) => ({
      id: s.id, at: +s.at.toFixed(2), end: +s.end.toFixed(2),
      scene: s.scene.fn.name, note: s.line.overlay || '',
    }));
    OP.captions = () => captionList().map((c) => ({
      s: +c.s.toFixed(2), e: +c.e.toFixed(2), text: c.words.map((w) => w.txt).join(' '),
    }));
    OP.ready = true;

    // Browser preview (not capture): ?t=12.3 holds a frame, otherwise play.
    const q = new URLSearchParams(location.search);
    if (!q.has('capture')) {
      if (q.has('t')) { draw(+q.get('t')); return; }
      const audio = new Audio('data/voice.wav');
      let t0 = null;
      const btn = document.getElementById('play');
      btn.hidden = false;
      btn.onclick = () => { btn.hidden = true; t0 = performance.now(); audio.currentTime = 0; audio.play().catch(() => {}); };
      const loop = (now) => {
        const t = t0 == null ? 0 : (now - t0) / 1000;
        draw(t0 == null ? 0 : t);
        if (t0 != null && t > T.dur) { t0 = null; btn.hidden = false; }
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }
  } catch (e) {
    OP.bootError = String((e && e.stack) || e);
    console.error(e);
  }
})();
