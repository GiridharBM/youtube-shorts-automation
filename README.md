# YouTube Shorts automation

The workflow creates two unlisted, sentence-paced Shorts from Google Trends:

- **Story:** original vector scenes with an animated stick figure.
- **Facts:** original vector illustrations with timed narration and captions.

OpenCode Go Beam writes scripts, Piper generates narration locally, and FFmpeg
assembles the videos. The workflow does not use paid video-generation or TTS
APIs; free-tier availability, rate limits, and GitHub Actions usage limits still
apply.

Each run also saves both MP4s and their 9:16 JPEG thumbnails as a downloadable
GitHub Actions artifact named `shorts-preview-<run id>` (kept for seven days).
YouTube's current Shorts guidance requires applying a custom thumbnail in
YouTube Studio on a computer. The Data API documents general thumbnail uploads
but not Shorts-specific support, so the generated images are included in the
artifact for manual use.

Run the local helper tests with `npm test`. Rendering additionally requires
FFmpeg, `rsvg-convert`, Piper, and the configured voice model.
