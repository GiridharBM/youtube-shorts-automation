import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMetadata,
  getProcessingFailure,
  isProcessingComplete,
  normalizePrivacy,
  parseArgs
} from './youtube-upload.mjs';

test('builds YouTube metadata with a safe title, sources, and style', () => {
  const metadata = buildMetadata({
    title: '  A <very>   short title  ',
    description: 'A quick explanation.',
    sources: ['Source one', 'Source two']
  }, 'paper-atlas');

  assert.equal(metadata.title, 'A very short title');
  assert.match(metadata.description, /A quick explanation\./);
  assert.match(metadata.description, /Source one/);
  assert.match(metadata.description, /#Shorts/);
  assert.deepEqual(metadata.tags, ['Shorts', 'paper-atlas']);
  assert.equal(metadata.categoryId, '24');
});

test('truncates an overlong title to YouTube limits', () => {
  const metadata = buildMetadata({ title: 'x'.repeat(150) }, 'inside-out');
  assert.equal(metadata.title.length, 100);
  assert.equal(metadata.categoryId, '27');
});

test('rejects invalid privacy values and malformed arguments', () => {
  assert.equal(normalizePrivacy(' Unlisted '), 'unlisted');
  assert.throws(() => normalizePrivacy('friends'), /Invalid YouTube privacy/);
  assert.deepEqual(parseArgs(['--video', 'a.mp4', '--privacy', 'private']), {
    video: 'a.mp4',
    privacy: 'private'
  });
  assert.throws(() => parseArgs(['--unknown', 'value']), /Unknown option/);
  assert.throws(() => parseArgs(['--video']), /Missing value/);
});

test('recognizes processing success and failures', () => {
  assert.equal(isProcessingComplete({ processingDetails: { processingStatus: 'succeeded' } }), true);
  assert.equal(isProcessingComplete({ processingDetails: { processingStatus: 'processing' } }), false);
  assert.match(getProcessingFailure({
    processingDetails: { processingStatus: 'failed', processingFailureReason: 'transcodeFailed' }
  }), /transcodeFailed/);
  assert.match(getProcessingFailure({
    status: { uploadStatus: 'rejected', rejectionReason: 'copyright' }
  }), /copyright/);
  assert.equal(getProcessingFailure({
    processingDetails: { processingStatus: 'processing' },
    status: { uploadStatus: 'uploaded' }
  }), '');
});
