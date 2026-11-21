#!/usr/bin/env python3
"""Hand the build over to the canvas renderer.

Writes the three files web/ fetches at boot:
  web/data/lines.json  { duration, lines: [{ i, text, overlay, visual, start, end }] }
  web/data/words.json  [{ w, line, s, e }]
  web/data/voice.wav   a copy, so `capture.mjs preview` can play it in a browser
"""
from __future__ import annotations

import pathlib
import shutil
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from common import BUILD, ROOT, die, load_config, log, read_json, write_json

DATA = ROOT / "web" / "data"


def main() -> None:
    cfg = load_config()
    script = read_json(BUILD / "script.json")
    timings = read_json(BUILD / "timings.json")
    words = read_json(BUILD / "words.json")
    if not (script and timings and words):
        die("need build/script.json, timings.json and words.json — "
            "run pick_topic.py, tts.py and words.py first")

    DATA.mkdir(parents=True, exist_ok=True)

    lines = []
    for beat in timings["beats"]:
        i = beat["index"]
        src = script["beats"][i] if i < len(script["beats"]) else {}
        lines.append({
            "i": i,
            "text": beat["text"],
            "overlay": (beat.get("overlay") or src.get("overlay") or "").strip(),
            "visual": (beat.get("visual") or src.get("visual") or "").strip(),
            "start": float(beat["start"]),
            "end": float(beat["end"]),
        })

    style = str(cfg["video"].get("style") or "auto").strip().lower()
    write_json(DATA / "lines.json",
               {"duration": float(timings["total"]), "style": style, "lines": lines})
    write_json(DATA / "words.json", words)

    voice = BUILD / "voice.wav"
    if voice.exists():
        shutil.copyfile(voice, DATA / "voice.wav")

    log(f"staged {len(lines)} beats / {len(words)} words, style={style!r} -> {DATA}")
    for ln in lines:
        log(f"  b{ln['i']} {ln['start']:6.2f}-{ln['end']:6.2f}  {ln['overlay'][:38]!r}")


if __name__ == "__main__":
    main()
