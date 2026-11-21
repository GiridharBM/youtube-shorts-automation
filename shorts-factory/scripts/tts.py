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
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from common import (BUILD, ROOT, die, ffprobe_duration, load_config, log,
                    read_json, run, write_json)

SR = 24000  # narration sample rate; plenty for speech, small files


def say_edge(text: str, out_mp3: pathlib.Path, cfg: dict) -> int:
    """Synthesise one beat. Returns the number of attempts it took.

    edge-tts talks to an unofficial Microsoft endpoint that rate-limits, and
    it is noticeably harsher on datacentre IPs than on a laptop — CI sees
    "No audio was received" far more often than local runs do. It is almost
    always transient, so this retries patiently with jittered backoff rather
    than failing the whole video over one beat.
    """
    import random
    import time

    import edge_tts

    async def go() -> None:
        comm = edge_tts.Communicate(
            text,
            voice=cfg["voice"]["name"],
            rate=cfg["voice"]["rate"],
            pitch=cfg["voice"]["pitch"],
        )
        await comm.save(str(out_mp3))

    attempts = int(cfg["voice"].get("attempts", 6))
    for attempt in range(1, attempts + 1):
        try:
            if out_mp3.exists():
                out_mp3.unlink()
            asyncio.run(go())
            if out_mp3.exists() and out_mp3.stat().st_size > 1024:
                return attempt
            raise RuntimeError("edge-tts produced an empty file")
        except Exception as exc:  # noqa: BLE001
            log(f"  edge-tts attempt {attempt}/{attempts} failed: {exc}")
            if attempt == attempts:
                die(f"edge-tts failed {attempts} times on one beat. This is "
                    "usually rate limiting rather than a bad voice name — "
                    "re-running often just works. To remove the dependency "
                    "entirely, set voice.backend to piper.")
            time.sleep(min(30.0, 2.0 * (2 ** (attempt - 1))) + random.random() * 2)
    return attempts


PIPER_HOST = "https://huggingface.co/rhasspy/piper-voices/resolve/main"


def piper_model(name: str) -> pathlib.Path:
    """Return the local .onnx for a voice like `en_US-ryan-high`, fetching it
    from the Piper voice library on first use."""
    voices = ROOT / "voices"
    voices.mkdir(exist_ok=True)
    onnx = voices / f"{name}.onnx"
    if onnx.exists() and onnx.stat().st_size > 1_000_000:
        return onnx

    try:
        locale, speaker, quality = name.split("-", 2)
        lang = locale.split("_")[0]
    except ValueError:
        die(f"piper voice {name!r} should look like en_US-ryan-high")
    base = f"{PIPER_HOST}/{lang}/{locale}/{speaker}/{quality}/{name}"

    log(f"fetching piper voice {name} (one time, then cached)")
    for ext in (".onnx", ".onnx.json"):
        dst = voices / f"{name}{ext}"
        run(["curl", "-sSL", "--fail", "--retry", "3", "-o", str(dst), base + ext])
        if not dst.exists() or dst.stat().st_size == 0:
            die(f"could not download {name}{ext} — check the voice name against "
                "https://huggingface.co/rhasspy/piper-voices")
    return onnx


def say_piper(text: str, out_wav: pathlib.Path, cfg: dict) -> None:
    """Synthesise locally. No network, no rate limits, no outages."""
    import subprocess

    model = piper_model(str(cfg["voice"]["piper_voice"]))
    exe = shutil.which("piper")
    cmd = ([exe] if exe else [sys.executable, "-m", "piper"]) + \
          ["-m", str(model), "-f", str(out_wav)]
    proc = subprocess.run(cmd, input=text, text=True, capture_output=True)
    if proc.returncode != 0 or not out_wav.exists() or out_wav.stat().st_size < 1024:
        sys.stderr.write((proc.stderr or "")[-2000:])
        die("piper failed to synthesise")


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

    # `voice.select` is "<backend>:<name>" so a single workflow input picks
    # both. piper runs locally; edge needs Microsoft's endpoint, which is
    # better when it works but goes down without warning.
    select = str(cfg["voice"].get("select") or "").strip()
    if select:
        head, _, name = select.partition(":")
        head = head.lower().strip()
        if head in ("piper", "edge") and name.strip():
            cfg["voice"]["backend"] = head
            key = "piper_voice" if head == "piper" else "name"
            cfg["voice"][key] = name.strip()
    backend = str(cfg["voice"]["backend"]).lower()
    log(f"voice backend={backend} "
        f"voice={cfg['voice']['piper_voice'] if backend == 'piper' else cfg['voice']['name']}")
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
            if i:
                time.sleep(float(cfg["voice"].get("pace_s", 0.8)))
            took = say_edge(text, raw, cfg)
            if took > 1:
                log(f"  (took {took} attempts)")
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
