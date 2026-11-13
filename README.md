# YouTube Shorts automation

The workflow creates two unlisted, sentence-paced Shorts from Google Trends:

- **Story:** original scene panels with an animated, shaded cartoon presenter.
- **Facts:** original fact-based explainer scripts with code-rendered animated vector scenes, timed narration, and captions.

OpenCode Go Beam writes scripts; it does not generate images or video. The
presenter, scene art, and motion-graphics panels are rendered as SVG, Piper
generates narration locally, and FFmpeg assembles the videos. This gives the
story presenter a shaded 2.5D cartoon look, not full 3D or AI-generated footage.
The workflow does not use paid video-generation or TTS APIs; free-tier
availability, rate limits, and GitHub Actions usage limits still apply.

Each run also saves both MP4s and their 9:16 JPEG thumbnails as a downloadable
GitHub Actions artifact named `shorts-preview-<run id>` (kept for seven days).
The artifact includes `shorts_upload_status.json` with the outcome for each
upload. If YouTube rejects an upload because the channel reached its limit, the
pipeline still renders both Shorts, skips further upload attempts for that run,
and preserves all outputs; the upload step remains failed so the limit is
visible in Actions.
YouTube's current Shorts guidance requires applying a custom thumbnail in
YouTube Studio on a computer. The Data API documents general thumbnail uploads
but not Shorts-specific support, so the generated images are included in the
artifact for manual use.

Run the local helper tests with `npm test`. Rendering additionally requires
FFmpeg, `rsvg-convert`, Piper, and the configured voice model.

If a workflow run renders the Shorts but reports `invalid_grant` during upload,
the YouTube OAuth refresh token has been rejected. Re-authorize the channel,
replace the `YT_REFRESH_TOKEN` secret under the repository's **Settings →
Secrets and variables → Actions**, and rerun the workflow. Do not put the token
in source code or workflow logs.
