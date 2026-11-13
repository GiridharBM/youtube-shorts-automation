# Faceless Shorts CI workflow

`.github/workflows/faceless-short.yml` generates one vertical Short with the vendored
[`faceless-shorts`](../.opencode/skills/faceless-shorts/SKILL.md) skill, then optionally uploads it to
YouTube. It is **manual only** (`workflow_dispatch`); it does not run on pushes or a schedule.

The existing `pipeline.yml` workflow is unchanged.

## What the job does

1. Checks out the repository and installs Node.js 22, Python 3.11, ffmpeg, and the OpenCode CLI.
2. Runs the repository tests, then `faceless-shorts/scripts/setup.sh`.
3. Verifies the selected `opencode-go/<model>` is present in the authenticated Go catalog.
4. Runs OpenCode non-interactively with the skill, the chosen style, and the topic.
5. Collects `short.mp4`, `thumbnail.jpg`, `script.json`, and the QA contact sheet.
6. If `upload_to_youtube` is true, uploads the MP4, waits for processing, and sets the custom thumbnail.
7. Always uploads the MP4 and thumbnail as a workflow artifact, whether YouTube upload ran or not.

## Runner requirements

The default `ubuntu-latest` GitHub-hosted runner is sufficient:

- Node.js 22+, Python 3.10+, ffmpeg, and Google Chrome. The workflow installs Node/Python/ffmpeg and
  fails clearly if Chrome is missing.
- No GPU, Ollama, self-hosted runner, or local model assets are required. The skill uses Kokoro TTS and
  Whisper on CPU, plus headless Chrome for rendering.
- `setup.sh` downloads about 1 GB of free voice/Whisper models into `$HOME/.faceless-shorts` on each run.
  These files are not committed and are not included in artifacts.
- The 2D styles (`inside-out`, `stick-story`, `paper-atlas`) are the best fit for a hosted runner. The 3D
  styles (`deep-dive`, `night-file`, `tall-tale`) work with software rendering but are much slower; the
  workflow instructs the agent to use `SOFTWARE_GL=1`, reduced resolution, and `FPS=24` for them.
- Timeouts: 30 minutes for setup, 75 minutes for generation, 50 minutes for YouTube, 180 minutes for the job.

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
be used. If the selected model is absent or blocked, the preflight step fails and lists the available
models; it never falls back to another provider or model.

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

Use a Go key with the narrowest permissions that still allows model requests. The generation process can
read its own environment, so do not give it a workspace-wide or billing key. The YouTube secrets are only
present in the upload step, never in the generation step.

If the OAuth consent screen is still in **Testing**, Google expires refresh tokens after 7 days. Publish
the app (and complete any verification Google requires for the sensitive scope) or re-run the helper
when uploads start failing with `invalid_grant`. A Brand Account channel must be authorized by an account
that can manage that channel.

The upload declares `selfDeclaredMadeForKids: false`. Change that in `scripts/youtube-upload.mjs` if your
content is directed to children. Review YouTube's synthetic/altered-media disclosure rules; the current
metadata does not set `status.containsSyntheticMedia`.

The API quota is normally 10,000 units/day. One run uses about 50 units for the thumbnail and 1 per
processing poll; the upload itself also counts against YouTube's separate daily Video Uploads bucket.
If you upload at high volume, check the project's quota and YouTube's API audit requirements.

## Run the workflow

1. Open **Actions → Generate faceless Short → Run workflow**.
2. Enter a `topic`, choose a `style` and an OpenCode Go `model`.
3. Leave `upload_to_youtube` as `false` for a dry run. The MP4 and thumbnail are still produced.
4. To upload, set `upload_to_youtube` to `true` and choose `youtube_visibility`:
   - `private` (default)
   - `unlisted`
   - `public`

The workflow has only `contents: read` permission, no pull-request trigger, and secrets are scoped to the
individual generation/upload steps. Fork pull requests never receive these secrets.

## Artifacts and YouTube report

Open the workflow run and use the **Artifacts** section. The artifact is named
`faceless-short-<run id>-<attempt>` and is kept for 7 days. It contains:

- `short.mp4` — the rendered 1080×1920 Short
- `thumbnail.jpg` — the 9:16 custom thumbnail
- `script.json` — title, narration, and sources
- `contact-sheet.jpg` — the QA contact sheet, when produced
- `youtube-upload.json` — upload result when YouTube upload was requested

`youtube-upload.json` is written for upload, processing, and thumbnail failures after the OAuth
configuration is validated. On a thumbnail failure it records the video ID and `thumbnailApplied: false`;
the workflow fails rather than reporting a false success.

## Failure behavior

- Missing Chrome, ffmpeg, Node, Python, or the Go credential fails before generation.
- A missing or blocked Go model fails in the preflight with the available model list.
- A missing final MP4 fails collection and preserves whatever files exist for inspection.
- YouTube `invalid_grant`, quota/upload limits, processing failures, and thumbnail errors fail the job
  with a specific message. Processing is polled for up to 45 minutes.
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
