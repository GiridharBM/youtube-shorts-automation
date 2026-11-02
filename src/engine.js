import { google } from 'googleapis';
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
  
  const prompt = "Return one factual, plain-text sentence about a well-established science, space, or historical fact suitable for a 15-second YouTube Short. Do not browse or claim the fact is trending or current. Keep it under 130 characters and do not include quotes or a preamble.";
  
  const response = await fetch('https://opencode.ai/inference/go/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + CONFIG.openCodeKey,
      'Content-Type': 'application/json',
      'User-Agent': 'youtube-shorts-automation/1.0',
      'x-opencode-session': 'youtube-shorts-automation-' + (process.env.GITHUB_RUN_ID || process.pid)
    },
    body: JSON.stringify({
      model: 'beam-free',
      messages: [{ role: 'user', content: prompt }]
    })
  });
  
  const result = await response.json();
  const choice = result.choices?.[0];
  if (!choice) {
    console.error("API Error Response Data Log:", result);
    throw new Error("Failed to get response from OpenCode model layer.");
  }
  const content = choice.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    console.error("OpenCode response did not contain text:", {
      finishReason: choice.finish_reason,
      messageFields: choice.message ? Object.keys(choice.message) : []
    });
    throw new Error("OpenCode returned no text content.");
  }
  return content.replace(/['"]/g, '').trim();
}

async function renderVideoFFmpeg(factText) {
  console.log("🎬 Compiling video overlay filters via cloud FFmpeg layer...");
  const cleanText = factText.replace(/:/g, '\\:'); 
  const outputName = 'shorts_output.mp4';
  
  let videoInput = 'assets/background.mp4';
  let fontInput = 'assets/font.ttf';
  let ffmpegCmd = '';

  if (fs.existsSync(videoInput) && fs.existsSync(fontInput)) {
    console.log("🎨 Found custom assets. Burning subtitles onto video background loop...");
    ffmpegCmd = "ffmpeg -stream_loop -1 -i " + videoInput + " -t 15 -vf \"drawtext=fontfile=" + fontInput + ":text='" + cleanText + "':fontcolor=white:fontsize=44:x=(w-text_w)/2:y=(h-text_h)/2:box=1:boxcolor=black@0.6:boxborderw=20\" -c:a copy -y " + outputName;
  } else {
    console.log("⚠️ Template assets missing. Falling back to dynamic backdrop engine...");
    ffmpegCmd = "ffmpeg -f lavfi -i color=c=black:s=1080x1920:d=15 -vf \"drawtext=text='" + cleanText + "':fontcolor=white:fontsize=36:x=(w-text_w)/2:y=(h-text_h)/2:box=1:boxcolor=gray@0.3:boxborderw=15\" -c:v libx264 -pix_fmt yuv420p -y " + outputName;
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
        description: textSnippet + "\n\n#shorts #viral #science #history #facts",
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

runner();