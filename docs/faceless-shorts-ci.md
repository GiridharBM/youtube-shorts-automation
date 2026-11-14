# Faceless Shorts CI workflow

`.github/workflows/faceless-short.yml` generates **two** vertical Shorts with the vendored
[`faceless-shorts`](../.opencode/skills/faceless-shorts/SKILL.md) skill, then optionally uploads both to
YouTube. It is **manual only** (`workflow_dispatch`); it does not run on pushes or a schedule.

## Which workflow is which

There are two workflows, and they produce very different videos.

| | `pipeline.yml` (legacy) | `faceless-short.yml` (skill) |
|---|---|---|
| Renderer | `src/engine.js`: Piper TTS + rsvg SVG scenes | the `faceless-shorts` skill: Kokoro + Whisper word timing + headless Chrome animation |
| Videos per run | 2 (one story, one facts clip) | 2 (one fact explainer, one story), both 25-60 s |
| Length | ~10-20 s (a couple of 5-9 word scenes) | 90-110 spoken words, 10-12 cuts |
| Voice | Piper `en_US-ljspeech-high` | Kokoro `am_michael` |
| Captions | one static sentence per scene | 1-3 word chunks, one yellow keyword, synced to the spoken word |
| Audio | narration only | voice + music bed + procedural sound cues |
| Thumbnail | none set, YouTube picks a frame | custom 9:16 thumbnail written through the API |
| Upload | always, unlisted, on a daily schedule | manual, private by default |

A Short published by the legacy workflow is **not** a skill render. If you want the skill look, run
**Generate faceless Shorts**.

### The legacy workflow, in plain words

`pipeline.yml` is the older, automatic pipeline. It runs every day on a schedule by itself and
publishes two short, generic clips to your channel. It does not use the skill, so those clips look
different from your local renders.

It is still there and it will keep publishing until you switch it off. To switch it off, open the
**Actions** tab in GitHub, click **Legacy Shorts Pipeline**, click the **...** menu at the top right,
and choose **Disable workflow**. That stops the schedule; you can re-enable it later from the same
menu. Deleting the file from the repository does the same thing permanently.

Nothing else has to change: the two workflows are independent.

## What the job does

1. Checks out the repository and installs Node.js 22, Python 3.11, ffmpeg, and the OpenCode CLI.
2. Runs the repository tests, then `faceless-shorts/scripts/setup.sh`.
3. Verifies the selected `opencode-go/<model>` is present in the authenticated Go catalog.
4. Runs OpenCode non-interactively twice: once for the **fact short**, once for the **story short**.
   Each run builds its own project with the skill, does the visual QA pass, and renders its own MP4
   and thumbnail.
5. Collects both MP4s, both thumbnails, both scripts, and both QA contact sheets.
6. If `upload_to_youtube` is true, uploads both shorts, waits for processing, and sets both
   custom thumbnails. One upload failing does not cancel the other.
7. Always uploads the MP4s and thumbnails as a workflow artifact, whether YouTube upload ran or not.

## Quality bar

The skill needs the same discipline locally and in CI, so the workflow prompt enforces it and the
collection step verifies it.

- **Script**: 90-110 spoken words, 10-12 lines, one cut per line, `caps` chunks of 1-3 words with
  exactly one highlighted word, and a `sources` list of checkable references with URLs.
- **Shots**: `src/shots.js` is rewritten with one shot per line, `cut(i)` placement, and key moments
  on words with `Wd('word', line)`.
- **Build order**: voice → words → `capture.mjs check` (must print `CHECK OK`) → cues → `mix.py` →
  contact sheet.
- **QA**: the agent must open `review/all.jpg`, read the whole sheet, open key frames full size, fix
  what it finds, re-render the sheet and look again. It reports the issues it fixed.
- **Hard gates in the collection step**: portrait video, 15-180 s duration, a real audio stream,
  non-silent audio, and a portrait JPEG thumbnail. A video shorter than 15 s means the script was too
  thin and the job fails instead of publishing a clip like that.

Style choice drives both look and render time. The defaults `inside-out` (fact) and `stick-story`
(story) are the 2D styles, so they render quickly on a hosted CPU runner. The 3D styles
(`deep-dive`, `night-file`, `tall-tale`) match a high-end local render but need software rendering,
roughly 30-40 minutes per video, and the two-video run can then take well over an hour.

## Runner requirements

The default `ubuntu-latest` GitHub-hosted runner is sufficient:

- Node.js 22+, Python 3.10+, ffmpeg, and Google Chrome. The workflow installs Node/Python/ffmpeg and
  fails clearly if Chrome is missing.
- No GPU, Ollama, self-hosted runner, or local model assets are required. The skill uses Kokoro TTS and
  Whisper on CPU, plus headless Chrome for rendering.
- `setup.sh` downloads about 1 GB of free voice/Whisper models into `$HOME/.faceless-shorts` on each run.
  These files are not committed and are not included in artifacts.
- Timeouts: 30 minutes for setup, 210 minutes for generating both shorts, 90 minutes for YouTube, and
  360 minutes for the whole job.

A self-hosted runner works if it provides the same tools and can reach `opencode.ai`, YouTube, and the
model-download hosts. Do not point the workflow at a developer laptop.

## OpenCode Go setup

1. Subscribe to Go in the [OpenCode Console](https://opencode.ai/console) and copy an API key from the
   workspace that owns the subscription. A personal key is the simplest option; use a service account key
   only if your Go plan covers it.
2. Add the key as the repository secret **`OPENCODE_API_KEY`** under
   **Settings → Secrets and variables → Actions**.
3. No `opencode auth login` is needed in CI. The CLI reads `OPENCODE_API_KEY` for the `opencode-go`
   provider, and the workflow passes `--standalone` so the private server receives that environment.
4. The workflow pins `@opencode/cli@2.3.0`. Change the pin deliberately after testing a newer CLI.

Model references use the documented form `opencode-go/<model-id>`. The workflow dropdown contains only
active Go models verified against the current catalog:

- `opencode-go/glm-5.3-flash` (default)
- `opencode-go/deepseek-v4.1-flash`
- `opencode-go/glm-5.3`
- `opencode-go/kimi-k3`
- `opencode-go/kimi-k3.1-pro`
- `opencode-go/minimax-m3.1-flash`
- `opencode-go/qwen3.8-flash`
- `opencode-go/claude-haiku-5-5`
- `opencode-go/gpt-6-luna`
- `opencode-go/grok-4.7`

`glm-5.3-flash` is the default because it is active, inexpensive, and available in the default Go region
settings. `deepseek-v4.1-flash` requires the workspace privacy setting **Regions → Global** before it can
be used, and it is the strongest option for the one-shot build-and-QA loop. If the selected model is
absent or blocked, the preflight step fails and lists the available models; it never falls back to
another provider or model.

The workflow never falls back to Copilot, a direct OpenAI API key, or another provider.

## YouTube OAuth setup

YouTube channel uploads use **user OAuth**, not a service account. A Google service account has no
YouTube channel, so it cannot upload to yours.

### Google Cloud

1. Create or select a Google Cloud project and enable **YouTube Data API v3**.
2. Configure the OAuth consent screen. Add the scope
   `https://www.googleapis.com/auth/youtube.force-ssl`.
   - `youtube.upload` alone is not enough: the workflow must call `videos.list` with
     `processingDetails` to wait for processing, and that method does not accept `youtube.upload`.
   - `youtube.force-ssl` covers `videos.insert`, `videos.list`, and `thumbnails.set`.
3. Create an OAuth client of type **Desktop app**. If you use a **Web application** client instead, add
   `http://127.0.0.1:8080` as an authorized redirect URI (or the exact `YT_REDIRECT_URI` you set).
4. Verify the target YouTube channel at <https://www.youtube.com/verify>. Custom thumbnails require a
   verified account.

### Get the refresh token

Run this locally, signed in as the account that owns the channel:

```bash
export YT_CLIENT_ID="..."
export YT_CLIENT_SECRET="..."
node scripts/get-youtube-refresh-token.mjs
```

Open the printed URL, approve the scope, and copy the printed refresh token. The helper listens only on
`127.0.0.1`, uses PKCE, `access_type=offline` and `prompt=consent`, and requests `youtube.force-ssl`.

Store these repository secrets:

| Secret | Purpose |
|---|---|
| `OPENCODE_API_KEY` | OpenCode Go API key used by the CLI |
| `YT_CLIENT_ID` | Google OAuth client ID |
| `YT_CLIENT_SECRET` | Google OAuth client secret |
| `YT_REFRESH_TOKEN` | Refresh token for the channel owner account |

Use a Go key with the narrowest permissions that still allow model requests. The generation process can
read its own environment, so do not give it a workspace-wide or billing key. The YouTube secrets are only
present in the upload step, never in the generation step.

If the OAuth consent screen is still in **Testing**, Google expires refresh tokens after 7 days. Publish
the app (and complete any verification Google requires for the sensitive scope) or re-run the helper
when uploads start failing with `invalid_grant`. A Brand Account channel must be authorized by an account
that can manage that channel.

The upload declares `selfDeclaredMadeForKids: false`. Change that in `scripts/youtube-upload.mjs` if your
content is directed to children. Review YouTube's synthetic/altered-media disclosure rules; the current
metadata does not set `status.containsSyntheticMedia`.

The API quota is normally 10,000 units/day. One video uses about 50 units for the thumbnail and 1 per
processing poll; the upload itself also counts against YouTube's separate daily Video Uploads bucket.
If you upload at high volume, check the project's quota and YouTube's API audit requirements.

## Run the workflow

1. Open **Actions → Generate faceless Shorts → Run workflow**.
2. Enter a `topic`. It seeds both shorts: the fact short explains it, the story short is inspired by it.
3. Choose `fact_style` (default `inside-out`) and `story_style` (default `stick-story`).
4. Choose an OpenCode Go `model`.
5. Leave `upload_to_youtube` as `false` for a dry run. Both shorts are still produced.
6. To upload, set `upload_to_youtube` to `true` and choose `youtube_visibility`:
   - `private` (default)
   - `unlisted`
   - `public`

The workflow has only `contents: read` permission, no pull-request trigger, and secrets are scoped to the
individual generation/upload steps. Fork pull requests never receive these secrets.

## Artifacts and YouTube report

Open the workflow run and use the **Artifacts** section. The artifact is named
`faceless-shorts-<run id>-<attempt>` and is kept for 7 days. It contains:

| File | What it is |
|---|---|
| `fact-short.mp4` | the factual explainer |
| `story-short.mp4` | the story short |
| `fact-thumbnail.jpg` / `story-thumbnail.jpg` | the two 9:16 custom thumbnails |
| `fact-script.json` / `story-script.json` | title, narration, caption chunks, and sources |
| `fact-contact-sheet.jpg` / `story-contact-sheet.jpg` | the QA contact sheets, when produced |
| `fact-upload.json` / `story-upload.json` | per-video upload result when YouTube upload was requested |

Each upload report is written for upload, processing, and thumbnail failures after the OAuth
configuration is validated. On a thumbnail failure it records the video ID and `thumbnailApplied: false`;
the workflow fails rather than reporting a false success.

## Failure behavior

- Missing Chrome, ffmpeg, Node, Python, or the Go credential fails before generation.
- A missing or blocked Go model fails in the preflight with the available model list.
- The fact short and the story short are generated independently: if one fails, the other is still
  attempted and still collected.
- A missing final MP4 fails collection and preserves whatever files exist for inspection.
- A video shorter than 15 s or longer than 180 s fails the duration gate with a message to rewrite
  the script with 90-110 words over 10-12 lines.
- YouTube `invalid_grant`, quota/upload limits, processing failures, and thumbnail errors fail the job
  with a specific message. Processing is polled for up to 45 minutes per video.
- Thumbnail success requires both a non-empty `thumbnails.set` response and a follow-up `videos.list`
  read. The workflow does not report success from an empty 200 response.
- The thumbnail is set only after `processingDetails.processingStatus` is `succeeded`, as required by
  the YouTube API for Shorts.

## Updating the vendored skill

The skill is copied into `.opencode/skills/faceless-shorts` so the workflow never references a path on a
developer machine. OpenCode discovers project skills from `.opencode/skills` automatically.

To update it, copy the contents of your global skill directory
`~/.config/opencode/skills/faceless-shorts` over `.opencode/skills/faceless-shorts`, keeping the binary
assets (`style-sheet.png`, fonts, and vendor files). Do not add generated videos, narration audio, model
downloads, or credentials to the repository.
