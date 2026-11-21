#!/usr/bin/env python3
"""Mux the captured visual track with the narration.

The picture (including captions) is already finished by tools/capture.mjs —
everything is drawn on the canvas, so there is no subtitle burn-in step and no
libass dependency. This stage only handles sound and final encoding.

Output: build/final.mp4
"""
from __future__ import annotations

import os
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from common import (BUILD, ROOT, die, ffprobe_duration, load_config, log,
                    read_json, run)


def main() -> None:
    cfg = load_config()
    visual = BUILD / "visual.mp4"
    voice = BUILD / "voice.wav"
    if not visual.exists():
        die("build/visual.mp4 missing — run `node tools/capture.mjs video` first")
    if not voice.exists():
        die("build/voice.wav missing — run tts.py first")

    timings = read_json(BUILD / "timings.json") or {}
    total = float(timings.get("total") or ffprobe_duration(voice))
    vdur = ffprobe_duration(visual)
    if abs(vdur - total) > 0.5:
        log(f"WARNING: visual {vdur:.2f}s vs narration {total:.2f}s")

    cmd = ["ffmpeg", "-y", "-v", "error", "-i", str(visual), "-i", str(voice)]

    music = (cfg["video"].get("music") or "").strip()
    music_path = ROOT / "assets" / "music" / music if music else None
    has_music = bool(music) and music_path.exists()
    if music and not has_music:
        log(f"WARNING: video.music={music!r} not in assets/music — skipping bed")
    if has_music:
        cmd += ["-stream_loop", "-1", "-i", str(music_path)]

    if has_music:
        db = float(cfg["video"]["music_db"])
        chain = (
            f"[2:a]volume={db}dB,afade=t=in:st=0:d=1.2,"
            f"afade=t=out:st={max(0.0, total - 1.4):.3f}:d=1.4[bed];"
            "[1:a][bed]amix=inputs=2:duration=first:dropout_transition=0,"
            "loudnorm=I=-14:TP=-1.0:LRA=11[a]"
        )
    else:
        chain = "[1:a]loudnorm=I=-14:TP=-1.0:LRA=11[a]"

    cmd += [
        "-filter_complex", chain,
        "-map", "0:v", "-map", "[a]",
        "-c:v", "libx264", "-preset", "medium", "-crf", str(cfg["video"]["crf"]),
        "-pix_fmt", "yuv420p", "-profile:v", "high", "-level", "4.1",
        "-g", str(int(cfg["video"]["fps"]) * 2),
        "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
        "-movflags", "+faststart",
        "-t", f"{total:.3f}",
        str(BUILD / "final.mp4"),
    ]
    run(cmd, cwd=str(ROOT))

    final = BUILD / "final.mp4"
    dur = ffprobe_duration(final)
    log(f"DONE {final} — {dur:.2f}s, {final.stat().st_size / 1e6:.1f} MB")
    if dur > 179:
        die(f"final video is {dur:.1f}s, over the 180s Shorts limit")

    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as fh:
            fh.write(f"- rendered `{final.name}` — {dur:.1f}s, "
                     f"{final.stat().st_size / 1e6:.1f} MB\n")


if __name__ == "__main__":
    main()
