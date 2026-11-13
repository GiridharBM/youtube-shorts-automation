import test from 'node:test';
import assert from 'node:assert/strict';
import { getYouTubeApiErrorReason } from './engine.js';
import { createAssCaptionTrack, createSceneSvg, createStoryPrompt, createThumbnailSvg, frameAlignedDuration, parseGoogleTrendsRss, parseStoryResponse } from './shorts.js';

const story = {
  title: 'A quick science discovery',
  topic: 'A quick science discovery',
  description: 'A short educational explainer.',
  scenes: Array.from({ length: 6 }, (_, index) => ({
    narration: `Scientists discovered a fascinating detail in scene ${index + 1}.`,
    visual: `A colorful illustration representing scene ${index + 1}.`
  }))
};

test('parses Google Trends RSS titles and related news safely', () => {
  const rss = `<?xml version="1.0"?>
    <rss><channel><item>
      <title>Science &amp; space</title>
      <ht:approx_traffic>10K+</ht:approx_traffic>
      <ht:news_item><ht:news_item_title><![CDATA[New &amp; curious discovery]]></ht:news_item_title>
        <ht:news_item_snippet>Details &quot;inside&quot;</ht:news_item_snippet>
        <ht:news_item_source>Example News</ht:news_item_source>
      </ht:news_item>
    </item><item><title>History</title></item></channel></rss>`;

  assert.deepEqual(parseGoogleTrendsRss(rss), [
    {
      title: 'Science & space',
      traffic: '10K+',
      news: [{
        title: 'New &amp; curious discovery',
        snippet: 'Details "inside"',
        source: 'Example News'
      }]
    },
    { title: 'History', traffic: '', news: [] }
  ]);
});

test('accepts a variable-scene story and fenced JSON', () => {
  assert.deepEqual(parseStoryResponse(`\`\`\`json\n${JSON.stringify(story)}\n\`\`\``), story);
  assert.equal(parseStoryResponse(JSON.stringify({ ...story, scenes: story.scenes.slice(0, 2) })).scenes.length, 2);
  assert.deepEqual(parseGoogleTrendsRss('<rss><channel><item><title><![CDATA[A &amp; B]]></title></item></channel></rss>'), [
    { title: 'A &amp; B', traffic: '', news: [] }
  ]);
});

test('builds separate original-fiction and fact-explainer prompts', () => {
  const trends = [{
    title: 'Science & space',
    traffic: '10K+',
    news: [{ title: 'News headline', snippet: 'A short snippet', source: 'Example' }]
  }];
  const cinematicPrompt = createStoryPrompt(trends, 'cinematic');
  const factsPrompt = createStoryPrompt(trends, 'facts');

  assert.match(cinematicPrompt, /original fictional mini-story/);
  assert.match(cinematicPrompt, /concrete goal, a complication, a decisive action, and an earned payoff/);
  assert.match(cinematicPrompt, /Keep the same character and important props recognizable across scenes/);
  assert.match(cinematicPrompt, /do not use real private people, existing movie or franchise characters/);
  assert.match(cinematicPrompt, /no fixed scene count or video duration/);
  assert.match(cinematicPrompt, /one complete narration sentence/);
  assert.match(factsPrompt, /evergreen, widely established fact/);
  assert.match(factsPrompt, /original faceless educational explainer/);
  assert.match(factsPrompt, /engaging hook, explain the idea with a concrete example, and end with a clear takeaway/);
  assert.match(factsPrompt, /explain the idea with a concrete example/);
  assert.match(factsPrompt, /specific visible action, object, or diagram/);
  assert.match(factsPrompt, /visuals that can be animated from simple vector shapes/);
  assert.match(factsPrompt, /not evidence/);
  assert.match(cinematicPrompt, /Science & space/);
  assert.throws(() => createStoryPrompt(trends, 'podcast'), /Unsupported Short format/);
});

test('rejects malformed or oversized story fields', () => {
  assert.throws(() => parseStoryResponse('not JSON'), /invalid story JSON/);
  assert.throws(
    () => parseStoryResponse(JSON.stringify({ ...story, topic: 'x'.repeat(51) })),
    /title, topic, or description exceeds/
  );
});

test('rejects empty stories, multi-sentence scenes, and captions that do not fit mobile', () => {
  assert.throws(
    () => parseStoryResponse(JSON.stringify({ ...story, scenes: [] })),
    /at least one scene/
  );
  const tooLong = {
    ...story,
    scenes: story.scenes.map((scene, index) =>
      index === 0 ? { ...scene, narration: 'one two three four five six seven eight nine ten' } : scene
    )
  };
  assert.throws(() => parseStoryResponse(JSON.stringify(tooLong)), /5–9 words/);

  const twoSentences = {
    ...story,
    scenes: story.scenes.map((scene, index) =>
      index === 0 ? { ...scene, narration: 'Scientists made a new discovery. It changed everything.' } : scene
    )
  };
  assert.throws(() => parseStoryResponse(JSON.stringify(twoSentences)), /exactly one sentence/);

  const overflowingVisual = {
    ...story,
    scenes: story.scenes.map((scene, index) =>
      index === 0 ? { ...scene, visual: 'An image representing a distinctive illustration with many more details that should never overflow onto the captions' } : scene
    )
  };
  assert.throws(() => parseStoryResponse(JSON.stringify(overflowingVisual)), /visual description must fit three lines/);
});

test('renders escaped, vertical SVG scenes with mobile-safe caption bounds', () => {
  const svg = createSceneSvg(
    { ...story, topic: 'Science & space <today>' },
    { narration: 'A & B discovered a <strange> new planet.', visual: 'An orbiting planet & bright stars.' },
    0
  );

  assert.match(svg, /width="1080" height="1920" viewBox="0 0 1080 1920"/);
  assert.match(svg, /Science &amp; space &lt;today&gt;/);
  assert.doesNotMatch(svg, /<text class="caption"/);
});

test('animates story scenes with original stick figures', () => {
  const scene = story.scenes[0];
  const firstFrame = createSceneSvg(story, scene, 0, { animated: true, frame: 0, frameCount: 8 });
  const nextFrame = createSceneSvg(story, scene, 0, { animated: true, frame: 2, frameCount: 8 });

  assert.match(firstFrame, /class="story-figure"/);
  assert.match(firstFrame, /<g transform="translate\(/);
  assert.notEqual(firstFrame.match(/<g transform="([^"]+)"/)[1], nextFrame.match(/<g transform="([^"]+)"/)[1]);
  assert.notEqual(firstFrame, nextFrame);
  assert.doesNotMatch(createSceneSvg(story, scene, 0), /class="story-figure"/);
});

test('matches football facts with a field scene and story animation with the described action', () => {
  const footballScene = {
    narration: 'The striker waits offside before the pass.',
    visual: 'A football attack with defenders and a marked line.'
  };
  const factsSvg = createSceneSvg(story, footballScene, 0, {
    animated: true,
    frame: 0,
    frameCount: 8,
    format: 'facts'
  });
  assert.match(factsSvg, /stroke-dasharray="14 12"/);
  assert.doesNotMatch(factsSvg, /class="story-figure"/);

  const storyScene = {
    narration: 'She reaches to save the letter.',
    visual: 'A child reaches for the red letter.'
  };
  const storySvg = createSceneSvg(story, storyScene, 0, {
    animated: true,
    frame: 0,
    frameCount: 8,
    format: 'cinematic'
  });
  assert.match(storySvg, /data-action="reach"/);
  assert.match(storySvg, /width="510" height="310"/);
});

test('creates distinct vertical story and fact thumbnail artwork', () => {
  const storyThumbnail = createThumbnailSvg(story, 'cinematic');
  const factsThumbnail = createThumbnailSvg(story, 'facts');

  assert.match(storyThumbnail, /width="1080" height="1920"/);
  assert.match(storyThumbnail, /A SHORT STORY/);
  assert.match(storyThumbnail, /class="story-figure"/);
  assert.match(factsThumbnail, /ONE CURIOUS FACT/);
  assert.doesNotMatch(factsThumbnail, /class="story-figure"/);
  assert.notEqual(storyThumbnail, factsThumbnail);
  assert.throws(() => createThumbnailSvg(story, 'podcast'), /Unsupported Short format/);
});

test('recognizes YouTube upload-limit errors from API responses', () => {
  assert.equal(getYouTubeApiErrorReason({ errors: [{ reason: 'uploadLimitExceeded' }] }), 'uploadLimitExceeded');
  assert.equal(
    getYouTubeApiErrorReason({ response: { data: { error: { errors: [{ reason: 'uploadLimitExceeded' }] } } } }),
    'uploadLimitExceeded'
  );
  assert.equal(getYouTubeApiErrorReason({ errors: [{ reason: 'forbidden' }] }), 'forbidden');
  assert.equal(getYouTubeApiErrorReason(new Error('invalid_grant')), 'invalid_grant');
  assert.equal(getYouTubeApiErrorReason({ response: { data: { error: 'invalid_grant' } } }), 'invalid_grant');
  assert.equal(getYouTubeApiErrorReason(new Error('network error')), '');
});

test('times readable ASS captions to spoken audio and scene boundaries', () => {
  const captions = createAssCaptionTrack(story.scenes.slice(0, 3), [3.2, 4.1, 2.8]);

  assert.match(captions, /ScriptType: v4\.00\+/);
  assert.match(captions, /Dialogue: 0,0:00:00\.00,0:00:03\.20,Caption/);
  assert.match(captions, /Dialogue: 0,0:00:03\.20,0:00:07\.30,Caption/);
  assert.match(captions, /Dialogue: 0,0:00:07\.30,0:00:10\.10,Caption/);
  assert.match(captions, /Scientists discovered a\\Nfascinating detail in scene\\N1\./);
  assert.throws(() => createAssCaptionTrack(story.scenes, [1]), /matching lengths/);
  assert.equal(frameAlignedDuration(3.2), 3.2);
  assert.equal(frameAlignedDuration(3.21), 3.2333333333333334);
});
