#!/usr/bin/env python3
"""Word-level timings with faster-whisper -> build/words.json.

This is what Whisper is for in this pipeline: it listens back to the narration
we generated and reports when every word starts and stops, so captions can
highlight the exact word being spoken.

Whisper's transcript is aligned back onto the SCRIPT's own spelling with
difflib, so captions always read "7" the way the script wrote it and never
inherit a mis-hearing. Words Whisper missed share the gap between their matched
neighbours, split by length.

If Whisper is unavailable the per-beat times from tts.py are still exact, so
words are spread inside each beat by length with pauses at punctuation — within
about 0.15s of the real speech, which is good enough to ship.

Output: build/words.json  [{ "w", "line", "s", "e" }]
"""
from __future__ import annotations

import pathlib
import re
import subprocess
import sys
from difflib import SequenceMatcher

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from common import BUILD, die, load_config, log, read_json, write_json

norm = lambda w: re.sub(r"[^a-z0-9]+", "", str(w).lower())  # noqa: E731


def decode(audio: pathlib.Path, sr: int = 16000):
    """Decode to the mono float32 array Whisper wants, using ffmpeg.

    faster-whisper would otherwise decode the file itself with PyAV, and that
    pairing breaks often: PyAV 19 dropped the `metadata_errors` argument that
    faster-whisper still passes, so `transcribe(path)` dies with a TypeError
    and silently costs you word-level captions. Handing it an array skips
    PyAV entirely, and ffmpeg is already a hard dependency of this project.
    """
    import numpy as np

    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(audio),
         "-f", "f32le", "-ac", "1", "-ar", str(sr), "-"],
        capture_output=True, check=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


def hear(audio: pathlib.Path, cfg: dict) -> list[tuple[str, float, float]]:
    from faster_whisper import WhisperModel

    size = cfg["captions"]["whisper_model"]
    log(f"loading whisper {size!r} (cpu/{cfg['captions']['compute_type']})")
    model = WhisperModel(size, device="cpu", compute_type=cfg["captions"]["compute_type"])
    segments, info = model.transcribe(
        decode(audio), language=cfg["channel"]["language"], word_timestamps=True,
        vad_filter=True, beam_size=5, condition_on_previous_text=False,
    )
    out = []
    for seg in segments:
        for w in (seg.words or []):
            if w.word.strip():
                out.append((w.word.strip(), float(w.start), float(w.end)))
    log(f"whisper heard {len(out)} words across {info.duration:.1f}s")
    return out


def align(script_words: list[str], heard: list[tuple[str, float, float]],
          t0: float, t1: float) -> list[tuple[float, float]]:
    """Map each script word to a (start, end), using the heard words where they
    match and interpolating across everything else."""
    a = [norm(w) for w in script_words]
    b = [norm(h[0]) for h in heard]
    times: list[tuple[float, float] | None] = [None] * len(a)

    for blk in SequenceMatcher(None, a, b, autojunk=False).get_matching_blocks():
        for k in range(blk.size):
            times[blk.a + k] = (heard[blk.b + k][1], heard[blk.b + k][2])

    i = 0
    while i < len(a):
        if times[i] is not None:
            i += 1
            continue
        j = i
        while j < len(a) and times[j] is None:
            j += 1
        lo = times[i - 1][1] if i > 0 and times[i - 1] else t0
        hi = times[j][0] if j < len(a) and times[j] else t1
        if hi <= lo:
            hi = lo + 0.06 * (j - i)
        weights = [max(1, len(a[k])) for k in range(i, j)]
        total = sum(weights)
        cur = lo
        for k, wgt in zip(range(i, j), weights):
            span = (hi - lo) * wgt / total
            times[k] = (cur, cur + span * 0.92)
            cur += span
        i = j
    return [t for t in times if t is not None]


def spread(words: list[str], t0: float, t1: float) -> list[tuple[float, float]]:
    """No-Whisper fallback: length-weighted, with a breath at punctuation."""
    weights = []
    for k, w in enumerate(words):
        extra = 0.0
        if w.endswith(","):
            extra = 2.5
        elif re.search(r"[.?!]$", w) and k < len(words) - 1:
            extra = 4.5
        weights.append(len(norm(w)) + 2.5 + extra)
    total = sum(weights) or 1
    out, cur = [], t0
    for w, wgt in zip(words, weights):
        span = (t1 - t0) * wgt / total
        speak = span * (len(norm(w)) + 2.5) / wgt
        out.append((cur, cur + speak * 0.94))
        cur += span
    return out


def main() -> None:
    cfg = load_config()
    voice = BUILD / "voice.wav"
    timings = read_json(BUILD / "timings.json")
    if not voice.exists() or not timings:
        die("build/voice.wav or build/timings.json missing — run tts.py first")

    heard: list[tuple[str, float, float]] = []
    try:
        heard = hear(voice, cfg)
    except Exception as exc:  # noqa: BLE001
        log(f"WARNING: whisper unavailable ({exc}); falling back to timed spread")

    out: list[dict] = []
    for beat in timings["beats"]:
        i = beat["index"]
        t0, t1 = float(beat["start"]), float(beat["end"])
        tokens = [w for w in str(beat["text"]).split() if norm(w)]
        if not tokens:
            continue
        mine = [h for h in heard if t0 - 0.25 <= (h[1] + h[2]) / 2 <= t1 + 0.25]
        times = align(tokens, mine, t0, t1) if len(mine) >= 2 else spread(tokens, t0, t1)
        if len(times) != len(tokens):
            times = spread(tokens, t0, t1)
        for w, (s, e) in zip(tokens, times):
            out.append({"w": w, "line": i,
                        "s": round(max(0.0, s), 3), "e": round(max(s + 0.05, e), 3)})

    if not out:
        die("produced no word timings")
    write_json(BUILD / "words.json", out)
    log(f"{len(out)} word timings -> build/words.json "
        f"({'whisper' if heard else 'estimated'})")


if __name__ == "__main__":
    main()
