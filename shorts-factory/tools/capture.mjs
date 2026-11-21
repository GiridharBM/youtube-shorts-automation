// Frame-exact capture of web/ through headless Chrome. No npm packages (Node 22+).
//
//   node tools/capture.mjs check                    boot, list beats + captions, report render errors
//   node tools/capture.mjs sheet [out.jpg] [step]   contact sheet, one frame every `step` s, time-stamped
//   node tools/capture.mjs frames [dir] "1.2,8.4"   full-size JPEGs at those times
//   node tools/capture.mjs video [out.mp4]          the silent visual track at FPS
//   node tools/capture.mjs preview                  serve it so you can watch in a browser
//
// CHROME=/path/to/chrome overrides the browser. FPS=24 renders faster.
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.join(REPO, 'web');
const FPS = +(process.env.FPS || 30);
const QUALITY = +(process.env.JPEG_Q || 0.93);

const CHROME = [
  process.env.CHROME,
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
  '/usr/bin/chromium-browser', '/snap/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find((p) => p && fs.existsSync(p));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const [mode, ...rest] = argv.filter((a) => !a.startsWith('--'));

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.wav': 'audio/wav', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg' };

function serve(port = 0) {
  return new Promise((res) => {
    const srv = http.createServer((req, r) => {
      const u = decodeURIComponent(req.url.split('?')[0]);
      const f = path.join(ROOT, u === '/' ? 'index.html' : u);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
      r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      fs.createReadStream(f).pipe(r);
    });
    srv.listen(port, '127.0.0.1', () => res(srv));
  });
}

async function openPage(port) {
  if (!CHROME) throw new Error('Chrome not found. Install Google Chrome, or set CHROME=/path/to/chrome');
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-chrome-'));
  const chrome = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${prof}`,
    '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
    '--window-size=1080,1920', '--force-device-scale-factor=1',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-dev-shm-usage', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
    ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
    'about:blank',
  ], { stdio: 'ignore' });

  let dbg;
  for (let i = 0; i < 300 && !dbg; i++) {
    try { dbg = fs.readFileSync(path.join(prof, 'DevToolsActivePort'), 'utf8').split('\n')[0].trim(); }
    catch { await sleep(100); }
  }
  if (!dbg) throw new Error('Chrome did not start');

  const url = `http://127.0.0.1:${port}/index.html?capture=1`;
  const r = await fetch(`http://127.0.0.1:${dbg}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  const target = await r.json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let id = 0; const pend = new Map(), logs = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) {
      const p = pend.get(m.id); pend.delete(m.id);
      m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
    } else if (m.method === 'Runtime.exceptionThrown') {
      logs.push('EXCEPTION ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      logs.push('ERROR ' + m.params.args.map((a) => a.value ?? a.description).join(' '));
    }
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params }));
  });
  const ev = async (expr) => {
    const x = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (x.exceptionDetails) throw new Error(x.exceptionDetails.exception?.description || x.exceptionDetails.text);
    return x.result.value;
  };
  await send('Runtime.enable');

  for (let i = 0; ; i++) {
    const st = await ev('window.OP ? (OP.bootError ? "ERR:" + OP.bootError : OP.ready) : false').catch(() => false);
    if (st === true) break;
    if (typeof st === 'string') throw new Error('boot failed: ' + st + '\n' + logs.join('\n'));
    if (i > 1200) throw new Error('boot timeout\n' + logs.join('\n'));
    await sleep(100);
  }
  const close = () => {
    try { ws.close(); } catch {}
    chrome.kill('SIGKILL');
    setTimeout(() => { try { fs.rmSync(prof, { recursive: true, force: true }); } catch {} }, 300);
  };
  return { ev, logs, close };
}

const jpg = (dataUrl) => Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
const FRAME = (t, q, stamp) => `(() => {
  const d = OP.frame(${t}, ${q});
  ${stamp ? `const cv = document.getElementById('cv'), c = cv.getContext('2d');
     c.setTransform(1,0,0,1,0,0); c.fillStyle='#000'; c.fillRect(0,0,250,86);
     c.fillStyle='#fff'; c.font='700 60px sans-serif'; c.textAlign='left'; c.textBaseline='alphabetic';
     c.fillText('${(+t).toFixed(2)}', 14, 64); return cv.toDataURL('image/jpeg', ${q});`
    : 'return d;'}
})()`;

const srv = await serve(mode === 'preview' ? 8765 : 0);
const port = srv.address().port;

if (mode === 'preview') {
  console.log(`open http://127.0.0.1:${port}/   (Ctrl+C to stop)`);
} else {
  let P;
  try {
    P = await openPage(port);
  } catch (e) {
    // Boot failures are almost always "you skipped a step", so say that
    // plainly instead of dumping a Node stack trace.
    const msg = String((e && e.message) || e).replace(/^boot failed: ERR:/, '');
    console.error('\nerror: ' + msg.split('\n').slice(0, 3).join('\n').trim());
    console.error('\nthe usual causes:\n' +
      '  - web/data/*.json missing      -> run scripts/stage.py\n' +
      '  - Chrome not installed/found   -> set CHROME=/path/to/chrome');
    srv.close();
    process.exit(1);
  }
  let failed = false;
  try {
    const dur = await P.ev('OP.duration()');

    if (mode === 'check' || !mode) {
      console.log(`duration ${dur.toFixed(2)} s   theme ${await P.ev('OP.theme()')}`);
      for (const s of await P.ev('OP.shots()')) {
        console.log(`  ${s.id.padEnd(4)} ${s.at.toFixed(2).padStart(6)} -> ${s.end.toFixed(2).padStart(6)}  ` +
                    `${s.scene.padEnd(8)} ${s.note}`);
      }
      const caps = await P.ev('OP.captions()');
      console.log(`captions: ${caps.length} chunks`);
      let bad = 0;
      for (let t = 0; t < dur; t += 0.25) {
        try { await P.ev(`OP.draw(${t})`); }
        catch (e) { bad++; console.log(`ERROR at ${t.toFixed(2)}: ${e.message.split('\n')[0]}`); }
      }
      if (P.logs.length) console.log(P.logs.join('\n'));
      failed = !!(bad || P.logs.length);
      console.log(failed ? 'CHECK FAILED' : 'CHECK OK');

    } else if (mode === 'frames') {
      const dir = path.resolve(REPO, rest[0] || 'build/review');
      fs.mkdirSync(dir, { recursive: true });
      for (const t of (rest[1] || '0').split(',').map(Number)) {
        fs.writeFileSync(path.join(dir, `t${t.toFixed(2)}.jpg`), jpg(await P.ev(FRAME(t, 0.92))));
      }
      console.log(dir);

    } else if (mode === 'sheet') {
      const out = path.resolve(REPO, rest[0] || 'build/review/sheet.jpg');
      const step = +(rest[1] || 1), cols = +(rest[2] || 8);
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-sheet-'));
      let n = 0;
      for (let t = step / 2; t < dur; t += step) {
        fs.writeFileSync(path.join(tmp, `f${String(n++).padStart(4, '0')}.jpg`), jpg(await P.ev(FRAME(t, 0.8, true))));
      }
      const rows = Math.ceil(n / cols);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-framerate', '1', '-i', path.join(tmp, 'f%04d.jpg'),
        '-vf', `scale=216:384,tile=${cols}x${rows}:padding=4:color=black`, '-frames:v', '1', '-q:v', '3', out]);
      fs.rmSync(tmp, { recursive: true, force: true });
      if (r.status) throw new Error('ffmpeg: ' + r.stderr);
      console.log(`${out} (${n} frames, every ${step}s)`);

    } else if (mode === 'video') {
      const out = path.resolve(REPO, rest[0] || 'build/visual.mp4');
      fs.mkdirSync(path.dirname(out), { recursive: true });
      const n = Math.round(dur * FPS);
      const draft = flags.has('--draft');
      const ff = spawn('ffmpeg', ['-v', 'error', '-y',
        '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
        '-an', '-c:v', 'libx264', '-preset', draft ? 'ultrafast' : 'veryfast',
        '-crf', draft ? '28' : '17', '-pix_fmt', 'yuv420p', out], { stdio: ['pipe', 'inherit', 'inherit'] });
      const t0 = Date.now();
      for (let i = 0; i < n; i++) {
        const b = jpg(await P.ev(FRAME(i / FPS, draft ? 0.8 : QUALITY)));
        if (!ff.stdin.write(b)) await new Promise((r) => ff.stdin.once('drain', r));
        if (i % 90 === 0) {
          const el = (Date.now() - t0) / 1000;
          const eta = i ? ((el / i) * (n - i)).toFixed(0) : '?';
          process.stdout.write(`\r  ${i}/${n} frames  ${el.toFixed(0)}s elapsed, ~${eta}s left   `);
        }
      }
      ff.stdin.end();
      const code = await new Promise((r) => ff.on('close', r));
      if (code) throw new Error('ffmpeg exited ' + code);
      console.log(`\r  ${out} — ${n} frames at ${FPS}fps in ${((Date.now() - t0) / 1000).toFixed(0)}s      `);

    } else {
      console.log('modes: check | sheet | frames | video | preview');
    }
  } finally {
    P.close(); srv.close();
  }
  if (failed) process.exit(1);
}
