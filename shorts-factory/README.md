# shorts-factory

Fully automatic animated YouTube Shorts on GitHub Actions. One cron run
produces one finished vertical video and publishes it.

**opencode is the only AI service in the chain.** No video-generation API, no
image API, no paid TTS. Everything after the script is drawn, rendered and
encoded on the runner.

```
cron ─► opencode run ──► script.json   (topic, title, description, tags, 6 beats)
          │
          ├─► edge-tts  ──► voice.wav + exact per-beat timings
          ├─► Whisper   ──► words.json  (when every word starts and ends)
          │
          ├─► headless Chrome ──► 1000+ animated canvas frames ──► visual.mp4
          └─► ffmpeg    ──► final.mp4  ──► YouTube Data API v3 ──► published
```

The picture is a **Canvas2D motion engine driven frame by frame**, not a
slideshow. `OP.frame(t)` draws film-time `t` as a pure function of `t`, and
`tools/capture.mjs` steps Chrome through every frame and pipes JPEGs straight
into ffmpeg. That is what makes the motion deterministic and reproducible —
no video editor, no timeline file, no npm dependencies.

---

## What actually moves

| layer | motion |
|---|---|
| **Backdrop** | two colour blooms orbiting on slow mutually-prime cycles, three parallax bokeh layers rising at different speeds, animated film grain, vignette |
| **Camera** | hard punch-in on every cut that settles over 0.42 s, plus a slow push across the whole beat and a gentle sway — the frame is never static |
| **Headline** | the beat's 2-5 word overlay, words dropping in on a damped spring with a stagger, then an accent rule wiping out underneath |
| **Scene** | one of ten animated scenes per beat (below), chosen from the beat's content |
| **Captions** | 2-3 word chunks, and the word **being spoken right now** turns accent-coloured and scales up — driven by Whisper's word timings |
| **Cuts** | a white flash on each beat change, fade from and to black at the ends |

### The ten scenes

`orbit` satellites circling a glowing core with motion trails · `bars` staggered
growing bars with one hero bar · `radar` sweep line with blips that light as it
passes · `wave` three scrolling sine waves with a travelling highlight ·
`dotgrid` a dot field with a diagonal pulse running through it · `flow` nodes
on a path with a packet travelling between them · `counter` a number counting
up inside a filling progress ring · `split` two panels sliding in for a
comparison · `burst` radial spokes with an expanding shockwave · `stack` cards
stacking in with a float.

The scene is picked from the beat text: a number anywhere in the beat gives
`counter`, "vs / but / more than" gives `split`, "first / then / becomes" gives
`flow`, "wave / signal / energy" gives `wave`, and so on. Whatever is left over
rotates through the unused scenes, so one video never shows the same scene
twice until all the others have had a turn.

### Why Whisper, when the voice is edge-tts

Whisper is speech-**to**-text — it cannot speak. Its job here is to listen back
to the narration we just generated and report when each individual word starts
and ends, which is what drives the word-by-word caption highlighting. Most
people watch Shorts muted, so this is the single highest-leverage thing in the
render.

Its transcript is aligned back onto the script's own spelling with `difflib`,
so a mis-hearing can never reach the screen. If Whisper is unavailable the
per-beat times from the TTS step are still exact, and words are spread inside
each beat by length — within ~0.15 s of the real speech.

For the voice itself: **edge-tts** (free, no key, ~400 neural voices) is the
default, with **Piper** as the fully offline fallback.

---

## Setup

### 1. opencode

```bash
curl -fsSL https://opencode.ai/install | bash
opencode auth login
opencode models        # copy one id into config.yaml -> opencode.model
```

Add whichever key your account uses as a repo secret — `OPENCODE_API_KEY`
(opencode Zen), or `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` /
`OPENROUTER_API_KEY` if you bring your own provider.

### 2. YouTube upload credentials

Upload needs OAuth; there is no API-key-only path.

1. [console.cloud.google.com](https://console.cloud.google.com) → new project
2. Enable **YouTube Data API v3**
3. OAuth consent screen → External → add yourself as a test user → then
   **publish the app** (Publishing status → In production)
4. Credentials → OAuth client ID → **Desktop app** → download
   `client_secret.json` into the repo root
5. `python3 scripts/get_refresh_token.py`

It prints three values. Add them under **Settings → Secrets and variables →
Actions**: `YT_CLIENT_ID`, `YT_CLIENT_SECRET`, `YT_REFRESH_TOKEN`.

> **The gotcha that breaks most of these projects in week two:** while the
> consent screen is in "Testing", Google expires refresh tokens after **7
> days**. The workflow then fails every day until you re-mint the token.
> Publish the app in step 3 and it stops happening.

### 3. Local requirements

Node **22+** (for the global `WebSocket` in `capture.mjs`), ffmpeg, and Google
Chrome or Chromium. `CHROME=/path/to/chrome` overrides detection.

```bash
./run_local.sh                      # full build, no upload
node tools/capture.mjs preview      # watch it play in a browser, with audio
```

Then in Actions: **Run workflow** with `dry_run: true` and download the
artifact. Only once you like the output, move `youtube.privacy` to `unlisted`,
then `public`.

---

## Working on the look

```bash
node tools/capture.mjs check                          # every frame renders? lists beats + scenes
node tools/capture.mjs sheet build/review/sheet.jpg 1 8   # time-stamped contact sheet
node tools/capture.mjs frames build/review "4.2,8.6"  # full-size frames at those times
node tools/capture.mjs video build/visual.mp4 --draft # fast, ugly, good enough to judge motion
FPS=24 node tools/capture.mjs video build/visual.mp4  # ~20% faster
```

**Never publish a frame you have not looked at.** The contact sheet is one
command and catches collisions, bad wrapping and empty scenes in one glance.
The workflow renders it on every run and attaches it to the artifact.

| file | what lives there |
|---|---|
| `web/src/core/lib.js` | canvas size, **the vertical layout bands**, palettes, easing, primitives |
| `web/src/core/kit.js` | backdrop, kinetic headline, kicker, progress rail |
| `web/src/scenes.js` | the ten scenes and the rules that choose one |
| `web/src/core/captions.js` | caption chunking, sizing and the word highlight |
| `web/src/main.js` | the camera, cut flash, fades — `draw(t)` itself |

### A warning about the layout constants

The camera scales everything inside it by up to ~1.15 about `y = H*0.52`, so a
scene's drawn bounds sit lower on screen than its numbers suggest. `HEAD_Y`,
`KICK_Y`, `SCENE_Y`, `SCENE_R`, `SCENE_W` and `CAP_TOP` in `lib.js` are set so
nothing reaches the caption zone at full punch-in. If you grow `SCENE_R`, check
the contact sheet for collisions — captions are drawn **outside** the camera
transform and will not move out of the way.

Captions are anchored by their **top** edge, so a two-row caption grows
downward instead of pushing its first row up into the scene.

### Adding a scene

Write a `function myScene(lt, d, s)` in `web/src/scenes.js` that draws around
`(CX, CY)` using only `lt` (time since the cut), `d` (beat length) and
`s.seed`. It must be a pure function of those — if it reads a frame counter or
`Date.now()`, capture breaks. Add it to `ALL`, optionally give it a keyword
rule in `sceneFor`, then run `check` and look at a sheet.

---

## Tuning

Everything else lives in `config.yaml`, and every scalar can be overridden by
an upper-cased env var (`VOICE_NAME`, `VIDEO_FPS`, `YOUTUBE_PRIVACY`, …) so you
can experiment from a `workflow_dispatch` run without a commit.

| Knob | Why you'd touch it |
|---|---|
| `channel.niche` | the most important line in the repo — it defines the channel |
| `script.beats` / `target_words` | 6 beats ≈ 45-55 s. More beats = faster cuts |
| `voice.name`, `voice.rate` | `edge-tts --list-voices`. `+8%` is a good retention default |
| `captions.whisper_model` | `base` is ~2x faster than `small` and nearly as accurate here |
| `video.fps` | 24 renders ~20% faster and still looks fine |
| `youtube.privacy` | start `private`, graduate to `public` |

### Script quality is the whole game

The prompt in `scripts/pick_topic.py` bans greetings and "like and subscribe",
forces an open loop in under 12 words, demands concrete nouns, and tells the
model to drop a number rather than guess one. It also asks for the `overlay`
(the big on-screen words) and `visual` (the kicker) per beat. If output feels
generic, edit that prompt — not the canvas code.

Rejected scripts are retried with the reason appended. Topics overlapping a
published one by more than 55% of tokens are rejected; `state/used_topics.json`
is the ledger and is committed back after each publish.

---

## Recommendations

**Do not publish straight to public on day one.** YouTube's
inauthentic-content rules hit mass-produced, low-effort uploads hardest, and a
new channel posting fully automated faceless videos at volume is exactly the
shape their systems look for. Run `private` for a week and watch every video.

**One or two videos a day, maximum.** Not a technical limit — a survival one.
The API allows ~6 uploads/day (1600 units each of 10,000), but nobody
subscribes to a firehose.

**Watch retention on the first two seconds and nothing else for 20 videos.**
That number is decided entirely by beat 1 of the script, which means it is
decided by the prompt, not by the animation.

**Keep a human in the loop at the cheapest point.** Upload as `private` and
post the link to a Discord or Telegram webhook. Approving with one tap is ten
seconds a day and removes nearly all the channel risk.

**Vary the voice across videos.** Three or four `edge-tts` voices picked by
topic hash is a four-line change, and identical narration on every upload is a
strong "mass-produced" signal.

**Cost reality:** a run is roughly 5-9 minutes (Whisper on CPU is the slow
part; the animation capture is ~20-60 s for 1000 frames). One daily video is
~250 min/month against the 2,000 free Actions minutes. Public repos are
unlimited.

---

## Layout

```
.github/workflows/shorts.yml   cron + the whole pipeline
config.yaml                    every knob
scripts/pick_topic.py          opencode -> validated script.json
scripts/tts.py                 per-beat narration + exact timings
scripts/words.py               Whisper word timings, aligned to script spelling
scripts/stage.py               hands build/ over to web/data/
scripts/render.py              mux narration (+ optional music bed)
scripts/upload.py              resumable YouTube upload
scripts/get_refresh_token.py   one-time local OAuth
tools/capture.mjs              headless Chrome frame capture (no npm deps)
web/                           the Canvas2D motion engine
state/used_topics.json         published-topic ledger (committed by CI)
run_local.sh                   full local build, no upload
```

### Troubleshooting

| Symptom | Cause |
|---|---|
| `CHECK FAILED` with a canvas error | a scene threw at some `t`. The message names the time — `frames` that time and look |
| `Chrome not found` | install Chrome/Chromium, or set `CHROME=/path/to/chrome` |
| `boot failed: ERR:...` | `web/` threw during boot, usually missing `web/data/*.json` — run `scripts/stage.py` |
| Captions overlap the scene | `SCENE_R`/`SCENE_Y` grew past what the camera scale allows — see the layout warning above |
| `no JSON object found in the output` | opencode isn't authed, or the model ignored the schema. Try the same prompt with `opencode run` |
| `invalid_grant` on upload | refresh token expired — consent screen still in "Testing" |
| `quotaExceeded` | 10,000 units/day ÷ 1600 per upload = 6. Wait, or request more |
| Text renders in a fallback font | `fonts-inter` wasn't available; it degrades to Liberation Sans and still looks fine |
