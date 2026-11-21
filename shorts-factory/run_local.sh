#!/usr/bin/env bash
# End-to-end local build, no upload. Tune the look and the voice here before
# you ever point this at a channel.
set -euo pipefail
cd "$(dirname "$0")"

command -v ffmpeg   >/dev/null || { echo "install ffmpeg first"; exit 1; }
command -v node     >/dev/null || { echo "install Node 22+ first"; exit 1; }
command -v opencode >/dev/null || { echo "install opencode first"; exit 1; }
case "$(node -v)" in v1*|v2[01].*) echo "need Node 22+, have $(node -v)"; exit 1;; esac

if [ ! -d .venv ]; then
  python3 -m venv .venv
  ./.venv/bin/pip install --upgrade pip -q
  ./.venv/bin/pip install -r requirements.txt
fi
PY=./.venv/bin/python

$PY scripts/pick_topic.py     # opencode writes the script
$PY scripts/tts.py            # narration + exact per-beat timings
$PY scripts/words.py          # Whisper word timings
$PY scripts/stage.py          # hand off to web/data

node tools/capture.mjs check                        # every frame must render
node tools/capture.mjs sheet build/review/sheet.jpg 1 8
node tools/capture.mjs video build/visual.mp4       # the animation
$PY scripts/render.py                               # + narration -> final.mp4

echo
echo "built:  $(pwd)/build/final.mp4"
echo "review: $(pwd)/build/review/sheet.jpg   <- look at this before publishing"
echo
echo "watch it live in a browser:   node tools/capture.mjs preview"
echo "test the upload path:         DRY_RUN=1 $PY scripts/upload.py"
