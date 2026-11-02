import fs from 'fs';
import path from 'path';

// 1. Define the project directory layout
const dirs = [
  'src',
  'assets',
  '.github',
  '.github/workflows'
];

console.log("📁 Creating project directory structures...");
dirs.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// 2. Define package.json file structure
const packageJson = {
  "name": "youtube-shorts-automation",
  "version": "1.0.0",
  "type": "module",
  "description": "Autonomous YouTube Shorts pipeline powered by OpenCode and GitHub Actions.",
  "main": "src/engine.js",
  "dependencies": {
    "googleapis": "^144.0.0",
    "node-fetch": "^2.7.0"
  }
};

// 3. Define the core processing engine script (src/engine.js)
const engineJs = `import { google } from 'googleapis';
import fetch from 'node-fetch';
import fs from 'fs';
import { execSync } from 'child_process';

const CONFIG = {
  openCodeKey: process.env.OPENCODE_ZEN_KEY,
  clientId: process.env.YT_CLIENT_ID,
  clientSecret: process.env.YT_CLIENT_SECRET,
  refreshToken: process.env.YT_REFRESH_TOKEN
};

async function generateScriptWithOpenCodeSearch() {
  console.log("🤖 Asking OpenCode to search the web and synthesize a viral fact...");
  
  const prompt = "Use your web search capability to discover today's trending, viral trivia topics or mind-blowing science, space, or historical facts. From the search results, extract ONE highly engaging trivia fact suitable for a 15-second YouTube Short. Clean the text, remove emojis, and keep it under 130 characters total. Return raw text only without quotes or introductory text.";
  
  // FIX: Using the explicit OpenCode inference API path string
  const response = await fetch('https://opencode.ai/inference/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + CONFIG.openCodeKey,
      'Content-Type': 'application/json',
      'x-opencode-session': 'automation-harness'
    },
    body: JSON.stringify({
      model: 'beam-free',
      messages: [{ role: 'user', content: prompt }]
    })
  });
  
  const result = await response.json();
  if (!result.choices || result.choices.length === 0) {
    console.error("API Error Response Data Log:", result);
    throw new Error("Failed to get response from OpenCode model layer.");
  }
  // FIX: Aligned structure array parsing rules with standard OpenAI responses schema
  return result.choices[0].message.content.replace(/['"]/g, '').trim();
}

async function renderVideoFFmpeg(factText) {
  console.log("🎬 Compiling video overlay filters via cloud FFmpeg layer...");
  const cleanText = factText.replace(/:/g, '\\\\:'); 
  const outputName = 'shorts_output.mp4';
  
  let videoInput = 'assets/background.mp4';
  let fontInput = 'assets/font.ttf';
  let ffmpegCmd = '';

  if (fs.existsSync(videoInput) && fs.existsSync(fontInput)) {
    console.log("🎨 Found custom assets. Burning subtitles onto video background loop...");
    ffmpegCmd = "ffmpeg -stream_loop -1 -i " + videoInput + " -t 15 -vf \\"drawtext=fontfile=" + fontInput + ":text='" + cleanText + "':fontcolor=white:fontsize=44:x=(w-text_w)/2:y=(h-text_h)/2:box=1:boxcolor=black@0.6:boxborderw=20\\" -c:a copy -y " + outputName;
  } else {
    console.log("⚠️ Template assets missing. Falling back to dynamic backdrop engine...");
    ffmpegCmd = "ffmpeg -f lavfi -i color=c=black:s=1080x1920:d=15 -vf \\"drawtext=text='" + cleanText + "':fontcolor=white:fontsize=36:x=(w-text_w)/2:y=(h-text_h)/2:box=1:boxcolor=gray@0.3:boxborderw=15\\" -c:v libx264 -pix_fmt yuv420p -y " + outputName;
  }
  
  execSync(ffmpegCmd);
  return outputName;
}

async function uploadToYouTube(filePath, textSnippet) {
  console.log("📤 Initializing secure headless YouTube Data API tunnel...");
  const oauth2Client = new google.auth.OAuth2(CONFIG.clientId, CONFIG.clientSecret);
  oauth2Client.setCredentials({ refresh_token: CONFIG.refreshToken });
  const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

  const title = "Did you know this? 🤯 #shorts #trending #facts";

  await youtube.videos.insert({
    part: 'status,snippet',
    requestBody: {
      snippet: {
        title: title,
        description: textSnippet + "\\n\\n#shorts #viral #science #history #facts",
        categoryId: '27'
      },
      status: { privacyStatus: 'public' }
    },
    media: { body: fs.createReadStream(filePath) }
  });
}

async function runner() {
  try {
    const cleanFact = await generateScriptWithOpenCodeSearch();
    console.log("✨ Generated Fact: " + cleanFact);
    
    const finalVideo = await renderVideoFFmpeg(cleanFact);
    await uploadToYouTube(finalVideo, cleanFact);
    
    console.log("🎉 Video pipeline run successfully deployed to channel!");
  } catch (err) {
    console.error("❌ Pipeline crashed during runtime execution loop:", err);
    process.exit(1);
  }
}

runner();`;

// 4. Define the cloud execution container workflow (.github/workflows/pipeline.yml)
const pipelineYml = `name: Continuous Autonomous Shorts Pipeline

on:
  schedule:
    - cron: '30 10 * * *'
  workflow_dispatch:

jobs:
  execute-pipeline:
    runs-on: ubuntu-latest
    steps:
      - name: Code Fetch Execution
        uses: actions/checkout@v4

      - name: Spin Up Node Environment
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Provision Media Tooling Libraries
        run: |
          sudo apt-get update
          sudo apt-get install -y ffmpeg

      - name: Clean Install Package Schemes
        run: npm install

      - name: Run Orchestrator Script Engine
        env:
          OPENCODE_ZEN_KEY: \${{ secrets.OPENCODE_ZEN_KEY }}
          YT_CLIENT_ID: \${{ secrets.YT_CLIENT_ID }}
          YT_CLIENT_SECRET: \${{ secrets.YT_CLIENT_SECRET }}
          YT_REFRESH_TOKEN: \${{ secrets.YT_REFRESH_TOKEN }}
        run: node src/engine.js`;

// 5. Write the compiled structures to disk
console.log("📝 Writing code structures into the workspace files...");
fs.writeFileSync('package.json', JSON.stringify(packageJson, null, 2));
fs.writeFileSync('src/engine.js', engineJs);
fs.writeFileSync('.github/workflows/pipeline.yml', pipelineYml);

console.log("🚀 Project initialization script complete!");
console.log("💡 Run 'npm install' inside this folder to sync dependencies.");
