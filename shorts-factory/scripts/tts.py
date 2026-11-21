#!/usr/bin/env python3
"""Turn the script into a narration track — one clip per beat, then joined.

Why per-beat instead of one long render: it hands us the exact duration of
every beat for free, so the slide changes line up with the narration to the
frame. No forced alignment, no drift.

Backends
  edge   - Microsoft Edge neural voices via edge-tts. Free, no API key,
           ~400 voices, by far the best quality you can get for nothing.
  piper  - fully offline ONNX model. Slightly more robotic but zero network.

Output: build/voice.wav, build/timings.json
"""
from __future__ import annotations

import asyncio
import pathlib
import shutil
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from common import (BUILD, die, ffprobe_duration, load_config, log, read_json,
                    run, write_json)

SR = 24000  # narration sample rate; plenty for speech, small files


def say_edge(text: str, out_mp3: pathlib.Path, cfg: dict) -> None:
    import edge_tts

    async def go() -> None:
        comm = edge_tts.Communicate(
            text,
            voice=cfg["voice"]["name"],
            rate=cfg["voice"]["rate"],
            pitch=cfg["voice"]["pitch"],
        )
        await comm.save(str(out_mp3))

    for attempt in range(1, 4):
        try:
            asyncio.run(go())
            if out_mp3.exists() and out_mp3.stat().st_size > 1024:
                return
            raise RuntimeError("edge-tts produced an empty file")
        except Exception as exc:  # noqa: BLE001
            log(f"  edge-tts attempt {attempt} failed: {exc}")
            if attempt == 3:
                die("edge-tts failed three times. Check the voice name with "
                    "`edge-tts --list-voices`, or switch voice.backend to piper.")
            import time
            time.sleep(3 * attempt)


def say_piper(text: str, out_wav: pathlib.Path, cfg: dict) -> None:
    model = cfg["voice"]["piper_model"]
    if not pathlib.Path(model).exists():
        die(f"piper model {model!r} not found. Download one from "
            "https://github.com/rhasspy/piper/releases (voices) first.")
    exe = shutil.which("piper")
    cmd = [exe, "-m", model, "-f", str(out_wav)] if exe else \
          [sys.executable, "-m", "piper", "-m", model, "-f", str(out_wav)]
    import subprocess
    proc = subprocess.run(cmd, input=text, text=True, capture_output=True)
    if proc.returncode != 0 or not out_wav.exists():
        sys.stderr.write(proc.stderr[-2000:])
        die("piper failed")


def to_wav(src: pathlib.Path, dst: pathlib.Path) -> None:
    run(["ffmpeg", "-y", "-v", "error", "-i", str(src),
         "-ac", "1", "-ar", str(SR),
         # Gentle polish: trim dead air, tame peaks, lift the body of the voice.
         "-af", "silenceremove=start_periods=1:start_silence=0.05:start_threshold=-50dB,"
                "highpass=f=85,acompressor=threshold=-18dB:ratio=3:attack=5:release=120,"
                "loudnorm=I=-16:TP=-1.5:LRA=11",
         str(dst)])


def silence(path: pathlib.Path, ms: int) -> None:
    run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi",
         "-i", f"anullsrc=r={SR}:cl=mono", "-t", f"{ms / 1000:.3f}",
         "-c:a", "pcm_s16le", str(path)])


def main() -> None:
    cfg = load_config()
    script = read_json(BUILD / "script.json") or die("build/script.json missing — run pick_topic.py first")
    beats = script["beats"]

    work = BUILD / "audio"
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)

    backend = cfg["voice"]["backend"].lower()
    gap_ms = int(cfg["voice"]["gap_ms"])
    silence(work / "gap.wav", gap_ms)

    pieces: list[pathlib.Path] = []
    timings: list[dict] = []
    cursor = 0.0

    for i, beat in enumerate(beats):
        text = " ".join(str(beat["text"]).split())
        log(f"beat {i + 1}/{len(beats)} ({len(text.split())} words): {text[:60]}...")
        raw = work / f"raw_{i:02d}"
        clean = work / f"beat_{i:02d}.wav"
        if backend == "edge":
            raw = raw.with_suffix(".mp3")
            say_edge(text, raw, cfg)
        elif backend == "piper":
            raw = raw.with_suffix(".wav")
            say_piper(text, raw, cfg)
        else:
            die(f"unknown voice.backend {backend!r} (use edge or piper)")
        to_wav(raw, clean)

        dur = ffprobe_duration(clean)
        timings.append({
            "index": i,
            "text": text,
            "overlay": beat.get("overlay", ""),
            "visual": beat.get("visual", ""),
            "start": round(cursor, 3),
            "end": round(cursor + dur, 3),
            "duration": round(dur, 3),
        })
        cursor += dur
        pieces.append(clean)
        if i < len(beats) - 1:
            pieces.append(work / "gap.wav")
            cursor += gap_ms / 1000.0

    # Join every clip into the final narration track.
    listing = work / "concat.txt"
    listing.write_text("".join(f"file '{p.name}'\n" for p in pieces), encoding="utf-8")
    voice = BUILD / "voice.wav"
    run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0",
         "-i", str(listing), "-c", "copy", str(voice)], cwd=str(work))

    total = ffprobe_duration(voice)
    if total > 175:
        die(f"narration is {total:.1f}s — over the 180s Shorts limit. "
            "Lower script.target_words or script.beats.")
    # Last beat absorbs any rounding drift so the timeline ends exactly on the audio.
    timings[-1]["end"] = round(total, 3)
    timings[-1]["duration"] = round(total - timings[-1]["start"], 3)

    write_json(BUILD / "timings.json", {"total": round(total, 3), "beats": timings})
    log(f"narration: {total:.2f}s across {len(beats)} beats -> {voice}")


if __name__ == "__main__":
    main()
