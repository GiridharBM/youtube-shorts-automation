import fs from 'fs';

const directories = ['src', 'assets', '.github/workflows'];
for (const directory of directories) {
  fs.mkdirSync(directory, { recursive: true });
}

for (const source of ['src/engine.js', 'src/shorts.js', 'src/shorts.test.js']) {
  if (!fs.existsSync(source)) {
    throw new Error(`Required project source file is missing: ${source}`);
  }
}

const packageJson = {
  name: 'youtube-shorts-automation',
  version: '1.0.0',
  type: 'module',
  description: 'Automated sentence-paced YouTube Shorts with original vector art, Piper TTS, and Google Trends.',
  main: 'src/engine.js',
  scripts: {
    start: 'node src/engine.js',
    test: 'node --test'
  },
  dependencies: {
    googleapis: '^144.0.0',
    'node-fetch': '^2.7.0'
  }
};

const pipelineYml = `name: Continuous Autonomous Shorts Pipeline

on:
  schedule:
    - cron: '30 10 * * *'
  workflow_dispatch:

jobs:
  execute-pipeline:
    runs-on: ubuntu-latest
    steps:
      - name: Check out source
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - name: Install media tools
        run: |
          sudo apt-get update
          sudo apt-get install -y ffmpeg librsvg2-bin fonts-dejavu-core

      - name: Install Piper and download licensed voice
        run: |
          python -m venv .venv
          .venv/bin/python -m pip install --upgrade pip
          .venv/bin/python -m pip install piper-tts
          .venv/bin/python -m piper.download_voices en_US-ljspeech-high --data-dir assets/piper

      - name: Install dependencies
        run: npm ci

      - name: Verify pipeline helpers
        run: npm test

      - name: Render and upload unlisted Shorts
        env:
          OPENCODE_ZEN_KEY: \${{ secrets.OPENCODE_ZEN_KEY }}
          YT_CLIENT_ID: \${{ secrets.YT_CLIENT_ID }}
          YT_CLIENT_SECRET: \${{ secrets.YT_CLIENT_SECRET }}
          YT_REFRESH_TOKEN: \${{ secrets.YT_REFRESH_TOKEN }}
          PIPER_PYTHON: \${{ github.workspace }}/.venv/bin/python
        run: npm start

      - name: Save rendered videos and thumbnails
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: shorts-preview-\${{ github.run_id }}
          path: |
            shorts_cinematic.mp4
            shorts_facts.mp4
            shorts_cinematic_thumbnail.jpg
            shorts_facts_thumbnail.jpg
          if-no-files-found: ignore
          retention-days: 7`;

fs.writeFileSync('package.json', `${JSON.stringify(packageJson, null, 2)}\n`);
fs.writeFileSync('.github/workflows/pipeline.yml', pipelineYml);

console.log('Project directories and package/workflow configuration are ready.');
console.log('Source files are maintained in src/ and are not overwritten by setup.');
