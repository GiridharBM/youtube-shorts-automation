// The narration's clock. Everything on screen is placed against it.
//   data/lines.json  { duration, lines: [{ i, text, overlay, visual, start, end }] }
//   data/words.json  [{ w, line, s, e }]
export const T = { dur: 0, lines: [], words: [] };

export async function loadTiming() {
  const get = async (f) => {
    const r = await fetch(f, { cache: 'no-store' });
    if (!r.ok) throw new Error(`missing ${f} — run scripts/stage.py`);
    return r.json();
  };
  const lines = await get('data/lines.json');
  T.lines = lines.lines;
  T.words = await get('data/words.json');
  T.dur = lines.duration;
  return T;
}

export const L  = (i) => T.lines[i].start;
export const Le = (i) => T.lines[i].end;
export const lineWords = (i) => T.words.filter((w) => w.line === i);
