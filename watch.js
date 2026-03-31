const chokidar = require('chokidar');
const path = require('path');
const {
  processImage,
  promptFilename,
  resolveName,
  logResult,
  INBOX_DIR,
  SUPPORTED_EXTS,
} = require('./lib/processor');

console.log(`\nWatching ./images/inbox/ for new images...`);
console.log('Drop a JPG or PNG to be prompted for a name.');
console.log('Press Ctrl+C to stop.\n');

const queue = [];
let busy = false;

async function drainQueue() {
  if (busy) return;
  busy = true;

  while (queue.length > 0) {
    const filePath = queue.shift();
    const originalName = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase();

    if (!SUPPORTED_EXTS.has(ext)) {
      console.log(`Skipping unsupported file: ${originalName}`);
      continue;
    }

    console.log(`\nNew file: ${originalName}`);
    const kebab = resolveName(await promptFilename(), originalName);

    if (!kebab) {
      console.log('  Skipped — file left in inbox.\n');
      continue;
    }

    try {
      logResult(await processImage(filePath, kebab));
    } catch (err) {
      console.error(`  ✗  Error processing ${originalName}: ${err.message}\n`);
    }
  }

  busy = false;
}

const watcher = chokidar.watch(INBOX_DIR, {
  // depth: 0 means only files directly inside INBOX_DIR, not subdirectories
  depth: 0,
  ignoreInitial: true,
  awaitWriteFinish: { stabilityThreshold: 600, pollInterval: 100 },
});

watcher.on('add', (filePath) => {
  queue.push(filePath);
  drainQueue();
});

watcher.on('error', (err) => console.error('Watcher error:', err));
