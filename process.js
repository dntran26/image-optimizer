const fs = require('fs');
const path = require('path');
const {
  processImage,
  promptFilename,
  resolveName,
  logResult,
  INBOX_DIR,
  SUPPORTED_EXTS,
} = require('./lib/processor');

async function run() {
  // withFileTypes avoids a separate statSync per file to check isFile()
  const files = fs
    .readdirSync(INBOX_DIR, { withFileTypes: true })
    .filter((d) => d.isFile() && SUPPORTED_EXTS.has(path.extname(d.name).toLowerCase()))
    .map((d) => d.name);

  if (files.length === 0) {
    console.log('No unprocessed images found in ./images/inbox/');
    return;
  }

  console.log(`\nFound ${files.length} image(s) in ./images/inbox/\n`);

  let processed = 0;
  let skipped = 0;

  for (const file of files) {
    console.log(`File: ${file}`);
    const kebab = resolveName(await promptFilename(), file);

    if (!kebab) {
      console.log('  Skipped.\n');
      skipped++;
      continue;
    }

    try {
      logResult(await processImage(path.join(INBOX_DIR, file), kebab));
      processed++;
    } catch (err) {
      console.error(`  ✗  Error: ${err.message}\n`);
    }
  }

  console.log(`Done.  |  Processed: ${processed}  |  Skipped: ${skipped}`);
}

run().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
