import test from 'node:test';
import assert from 'node:assert/strict';
import { createAssCaptionTrack, createSceneSvg, createStoryPrompt, frameAlignedDuration, parseGoogleTrendsRss, parseStoryResponse } from './shorts.js';

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
  assert.match(cinematicPrompt, /do not use real private people, existing movie or franchise characters/);
  assert.match(cinematicPrompt, /no fixed scene count or video duration/);
  assert.match(cinematicPrompt, /one complete narration sentence/);
  assert.match(factsPrompt, /evergreen, widely established fact/);
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
