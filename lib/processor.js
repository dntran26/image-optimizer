const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const INBOX_DIR = path.resolve('./images/inbox');
const PROCESSED_DIR = path.resolve('./images/inbox/processed');
const OPTIMIZED_DIR = path.resolve('./images/optimized');
const SUPPORTED_EXTS = new Set(['.jpg', '.jpeg', '.png']);

// Create output dirs once when the module is first loaded
fs.mkdirSync(PROCESSED_DIR, { recursive: true });
fs.mkdirSync(OPTIMIZED_DIR, { recursive: true });

function toKebabCase(str) {
  return str
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s\-_]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// Returns the kebab-case name to use, or null if the file should be skipped.
function resolveName(answer, originalFile) {
  if (answer.toLowerCase() === 'skip') return null;
  const base = answer || path.basename(originalFile, path.extname(originalFile));
  return toKebabCase(base) || null;
}

function getUniqueOutputPath(basename, ext) {
  let candidate = path.join(OPTIMIZED_DIR, `${basename}${ext}`);
  if (!fs.existsSync(candidate)) return candidate;
  let n = 2;
  do {
    candidate = path.join(OPTIMIZED_DIR, `${basename}-${n}${ext}`);
    n++;
  } while (fs.existsSync(candidate));
  return candidate;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function logResult(result) {
  const sizeNote = result.grew
    ? `+${result.saved} — lossless PNG may be larger than lossy source`
    : `saved ${result.saved}`;
  console.log(`  ✓  ${result.originalName}  →  ${result.newName}`);
  console.log(`     ${result.originalSize}  →  ${result.newSize}  (${sizeNote})\n`);
}

// Returns true if the image has an alpha channel with at least one non-opaque pixel.
async function isAlphaUsed(filePath) {
  const { hasAlpha } = await sharp(filePath).metadata();
  if (!hasAlpha) return false;
  const { channels } = await sharp(filePath).extractChannel('alpha').stats();
  return channels[0].min < 255;
}

async function processImage(filePath, newBasename, opts = {}) {
  const {
    quality = 80,
    maxWidth = null,
    maxHeight = null,
    outputFormat = 'auto', // 'auto' | 'jpg' | 'png' | 'webp'
  } = opts;

  const ext = path.extname(filePath).toLowerCase();
  const originalName = path.basename(filePath);
  const { size: originalSize } = await fs.promises.stat(filePath);

  // Determine output extension
  let outputExt;
  if (outputFormat === 'jpg') {
    outputExt = '.jpg';
  } else if (outputFormat === 'png') {
    outputExt = '.png';
  } else if (outputFormat === 'webp') {
    outputExt = '.webp';
  } else {
    // auto: PNGs without real transparency are treated as photos and converted to JPG.
    const isPng = ext === '.png';
    outputExt = isPng && !(await isAlphaUsed(filePath)) ? '.jpg' : ext;
  }

  const outputPath = getUniqueOutputPath(newBasename, outputExt);

  // Build pipeline — auto-rotate from EXIF first, then optional resize
  let pipeline = sharp(filePath).rotate();
  if (maxWidth || maxHeight) {
    pipeline = pipeline.resize(maxWidth || null, maxHeight || null, {
      fit: 'inside',
      withoutEnlargement: true,
    });
  }

  // sharp's .toFile() resolves with output info including size — no second stat needed
  let sharpInfo;
  if (outputExt === '.jpg' || outputExt === '.jpeg') {
    sharpInfo = await pipeline.jpeg({ quality }).toFile(outputPath);
  } else if (outputExt === '.webp') {
    sharpInfo = await pipeline.webp({ quality }).toFile(outputPath);
  } else {
    sharpInfo = await pipeline.png({ compressionLevel: 9 }).toFile(outputPath);
  }
  const newSize = sharpInfo.size;

  const savedBytes = originalSize - newSize;
  const savedPct = ((savedBytes / originalSize) * 100).toFixed(1);

  await fs.promises.rename(filePath, path.join(PROCESSED_DIR, originalName));

  return {
    originalName,
    newName: path.basename(outputPath),
    originalSize: formatBytes(originalSize),
    newSize: formatBytes(newSize),
    saved: `${formatBytes(Math.abs(savedBytes))} (${savedPct}%)`,
    grew: savedBytes < 0,
  };
}

function promptFilename() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`  New name (Enter to keep original, "skip" to skip): `, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

module.exports = {
  processImage,
  promptFilename,
  resolveName,
  logResult,
  INBOX_DIR,
  SUPPORTED_EXTS,
};
