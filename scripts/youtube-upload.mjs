import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { google } from 'googleapis';
import { getYouTubeApiErrorReason } from '../src/engine.js';

const PRIVACY_VALUES = new Set(['private', 'unlisted', 'public']);
const STORY_STYLES = new Set(['night-file', 'paper-atlas', 'tall-tale']);
const UPLOAD_TIMEOUT_MS = 30 * 60 * 1000;
const PROCESSING_TIMEOUT_MS = 45 * 60 * 1000;
const THUMBNAIL_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_DESCRIPTION_LENGTH = 5000;

const ARG_NAMES = new Set(['video', 'thumbnail', 'metadata', 'style', 'privacy', 'report']);

export function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      throw new Error(`Unexpected argument: ${token}`);
    }

    const name = token.slice(2);
    if (!ARG_NAMES.has(name)) {
      throw new Error(`Unknown option: --${name}`);
    }

    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for --${name}.`);
    }

    args[name] = value;
    index += 1;
  }
  return args;
}

export function normalizePrivacy(value) {
  const privacy = String(value || '').trim().toLowerCase();
  if (!PRIVACY_VALUES.has(privacy)) {
    throw new Error(`Invalid YouTube privacy "${value}". Use private, unlisted, or public.`);
  }
  return privacy;
}

function cleanText(value, maxLength) {
  return String(value || '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function buildMetadata(script, style = '') {
  if (!script || typeof script !== 'object' || typeof script.title !== 'string') {
    throw new Error('script.json is missing a title.');
  }

  const title = cleanText(script.title, 100) || 'Faceless Short';
  const summary = typeof script.description === 'string' ? cleanText(script.description, 500) : '';
  const sources = Array.isArray(script.sources)
    ? script.sources.filter(source => typeof source === 'string' && source.trim()).slice(0, 8)
    : [];

  const description = [
    summary,
    'Original faceless short made with the faceless-shorts skill.',
    style ? `Style: ${style}.` : '',
    sources.length > 0 ? `Sources:\n${sources.map(source => `- ${source.trim()}`).join('\n')}` : '',
    '#Shorts'
  ].filter(Boolean).join('\n\n').slice(0, MAX_DESCRIPTION_LENGTH);

  return {
    title,
    description,
    tags: ['Shorts', ...(style ? [style] : [])].slice(0, 30),
    categoryId: STORY_STYLES.has(style) ? '24' : '27'
  };
}

export function readScript(filePath) {
  let script;
  try {
    script = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read ${filePath} as JSON.`, { cause: error });
  }
  return script;
}

export function getProcessingFailure(item) {
  const processingStatus = item?.processingDetails?.processingStatus;
  const uploadStatus = item?.status?.uploadStatus;

  if (processingStatus === 'failed' || processingStatus === 'terminated') {
    const reason = item?.processingDetails?.processingFailureReason;
    return `processingStatus=${processingStatus}${reason ? `, reason=${reason}` : ''}`;
  }
  if (uploadStatus === 'failed' || uploadStatus === 'rejected' || uploadStatus === 'deleted') {
    const reason = item?.status?.rejectionReason || item?.status?.failureReason;
    return `uploadStatus=${uploadStatus}${reason ? `, reason=${reason}` : ''}`;
  }
  return '';
}

export function isProcessingComplete(item) {
  return item?.processingDetails?.processingStatus === 'succeeded';
}

export function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)} seconds.`)),
      timeoutMs
    );
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function videoUrl(videoId) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function writeReport(reportPath, report) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

export function formatFailure(error, apiReason, stage = '') {
  const denied = apiReason === 'insufficientPermissions' || apiReason === 'forbidden';
  const hints = {
    invalid_grant: 'YouTube rejected the refresh token. Re-run scripts/get-youtube-refresh-token.mjs and update YT_REFRESH_TOKEN.',
    uploadLimitExceeded: 'The channel has reached its YouTube upload limit. Try again later.',
    quotaExceeded: 'The YouTube Data API quota is exhausted. Wait for the quota reset or request more quota.',
    forbidden: 'The OAuth account cannot upload to this channel, or the channel is not verified for custom thumbnails.',
    invalidImage: 'YouTube rejected the thumbnail image. Use a JPEG or PNG within the size limit.',
    videoNotFound: 'YouTube could not find the uploaded video.',
    uploadRateLimitExceeded: 'YouTube rate-limited thumbnail uploads. Try again later.'
  };

  const stageHints = {
    processing: denied
      ? 'The refresh token has no read scope, so videos.list (needed for the processing status) was refused. Re-authorize with the youtube.force-ssl scope: node scripts/get-youtube-refresh-token.mjs, then update YT_REFRESH_TOKEN.'
      : '',
    thumbnail: denied
      ? 'YouTube refused to set the custom thumbnail. Verify the channel at https://www.youtube.com/verify, and note that YouTube currently documents custom Short thumbnails only in YouTube Studio.'
      : '',
    upload: denied ? 'The refresh token is missing the scope this call needs (youtube.force-ssl).' : ''
  };

  return [
    'YouTube step failed',
    stage ? ` during ${stage}` : '',
    apiReason ? ` (${apiReason})` : '',
    `: ${error?.message || String(error)}`,
    hints[apiReason] ? ` ${hints[apiReason]}` : '',
    stageHints[stage] ? ` ${stageHints[stage]}` : ''
  ].join('');
}

async function waitForProcessing(youtube, videoId) {
  const startedAt = Date.now();
  let delayMs = 5000;

  for (;;) {
    const response = await withTimeout(
      youtube.videos.list({ part: 'processingDetails,status', id: videoId }),
      60 * 1000,
      'YouTube processing check'
    );
    const item = response.data?.items?.[0];
    if (!item) {
      throw new Error(`YouTube returned no video for ID ${videoId} while checking processing.`);
    }

    const processingStatus = item.processingDetails?.processingStatus || 'unknown';
    const uploadStatus = item.status?.uploadStatus || 'unknown';
    console.log(`YouTube processing: ${processingStatus} (upload ${uploadStatus})`);

    const failure = getProcessingFailure(item);
    if (failure) {
      throw new Error(`YouTube processing failed: ${failure}`);
    }
    if (isProcessingComplete(item)) {
      return item;
    }
    if (Date.now() - startedAt >= PROCESSING_TIMEOUT_MS) {
      throw new Error(
        `Timed out after ${Math.round(PROCESSING_TIMEOUT_MS / 60000)} minutes waiting for YouTube processing. ` +
        `Last status: ${processingStatus}/${uploadStatus}.`
      );
    }

    await sleep(delayMs);
    delayMs = Math.min(Math.round(delayMs * 1.5), 30000);
  }
}

async function setThumbnail(youtube, videoId, thumbnailPath) {
  const response = await withTimeout(
    youtube.thumbnails.set({
      videoId,
      media: { mimeType: 'image/jpeg', body: fs.createReadStream(thumbnailPath) }
    }),
    THUMBNAIL_TIMEOUT_MS,
    'YouTube thumbnail upload'
  );

  const items = response.data?.items;
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error(
      'YouTube returned success for the thumbnail request but no thumbnail item, so the custom thumbnail was not applied.'
    );
  }

  const urls = items.flatMap(item =>
    ['default', 'medium', 'high', 'standard', 'maxres']
      .map(size => item?.[size]?.url)
      .filter(Boolean)
  );
  if (urls.length === 0) {
    throw new Error('YouTube returned thumbnail metadata without any URLs; not reporting thumbnail success.');
  }

  const check = await withTimeout(
    youtube.videos.list({ part: 'snippet', id: videoId }),
    60 * 1000,
    'YouTube thumbnail verification'
  );
  const snippetThumbnails = check.data?.items?.[0]?.snippet?.thumbnails;
  const verifiedUrl = snippetThumbnails?.high?.url || snippetThumbnails?.default?.url;
  if (!verifiedUrl) {
    throw new Error('YouTube accepted the thumbnail, but a follow-up read did not return a video thumbnail.');
  }

  return { urls, verifiedUrl };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const name of ['video', 'thumbnail', 'metadata', 'privacy']) {
    if (!args[name]) {
      throw new Error(`Missing required option --${name}.`);
    }
  }

  const videoPath = path.resolve(args.video);
  const thumbnailPath = path.resolve(args.thumbnail);
  const metadataPath = path.resolve(args.metadata);
  const reportPath = path.resolve(args.report || 'youtube-upload.json');
  const privacy = normalizePrivacy(args.privacy);
  const style = args.style || '';

  for (const [label, filePath] of [['video', videoPath], ['thumbnail', thumbnailPath], ['metadata', metadataPath]]) {
    if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
      throw new Error(`Missing or empty ${label} file: ${filePath}`);
    }
  }

  const script = readScript(metadataPath);
  const metadata = buildMetadata(script, style);

  const clientId = process.env.YT_CLIENT_ID;
  const clientSecret = process.env.YT_CLIENT_SECRET;
  const refreshToken = process.env.YT_REFRESH_TOKEN;
  const missing = [
    ['YT_CLIENT_ID', clientId],
    ['YT_CLIENT_SECRET', clientSecret],
    ['YT_REFRESH_TOKEN', refreshToken]
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`Missing YouTube OAuth environment variables: ${missing.join(', ')}`);
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

  let videoId = null;
  let stage = 'upload';
  try {
    console.log(`Uploading ${path.basename(videoPath)} as ${privacy}...`);
    const upload = await withTimeout(
      youtube.videos.insert({
        part: 'snippet,status',
        notifySubscribers: false,
        requestBody: {
          snippet: {
            title: metadata.title,
            description: metadata.description,
            tags: metadata.tags,
            categoryId: metadata.categoryId
          },
          status: {
            privacyStatus: privacy,
            selfDeclaredMadeForKids: false
          }
        },
        media: { mimeType: 'video/mp4', body: fs.createReadStream(videoPath) }
      }),
      UPLOAD_TIMEOUT_MS,
      'YouTube upload'
    );

    videoId = upload.data?.id;
    if (!videoId) {
      throw new Error('YouTube returned no video ID after the upload.');
    }
    console.log(`Uploaded: ${videoUrl(videoId)}`);

    stage = 'processing';
    const processed = await waitForProcessing(youtube, videoId);
    console.log('YouTube processing succeeded.');

    stage = 'thumbnail';
    const thumbnail = await setThumbnail(youtube, videoId, thumbnailPath);
    const report = {
      uploadedAt: new Date().toISOString(),
      videoId,
      url: videoUrl(videoId),
      privacyStatus: privacy,
      title: metadata.title,
      processingStatus: processed.processingDetails?.processingStatus,
      uploadStatus: processed.status?.uploadStatus,
      thumbnailApplied: true,
      thumbnailUrls: thumbnail.urls,
      videoThumbnailUrl: thumbnail.verifiedUrl
    };
    writeReport(reportPath, report);

    console.log(`Thumbnail applied and verified: ${thumbnail.verifiedUrl}`);
    console.log(`Upload report: ${reportPath}`);
  } catch (error) {
    const apiReason = getYouTubeApiErrorReason(error);
    const message = formatFailure(error, apiReason, stage);
    try {
      writeReport(reportPath, {
        uploadedAt: new Date().toISOString(),
        videoId,
        url: videoId ? videoUrl(videoId) : null,
        privacyStatus: privacy,
        title: metadata.title,
        stage,
        thumbnailApplied: false,
        error: message,
        apiReason: apiReason || null
      });
    } catch (reportError) {
      console.error(`Could not write upload report: ${reportError.message}`);
    }
    throw new Error(message, { cause: error });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`❌ ${error.message}`);
    process.exitCode = 1;
    // A timed-out upload can leave a socket open; force CI to exit after flushing logs.
    setTimeout(() => process.exit(1), 1000).unref();
  });
}
