const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileP = promisify(execFile);

const INBOX_DIR = path.resolve('./images/inbox');
const PROCESSED_DIR = path.resolve('./images/inbox/processed');
const OPTIMIZED_DIR = path.resolve('./images/optimized');
const SUPPORTED_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.pdf']);
const PDF_EXTS = new Set(['.pdf']);

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

// Decimal units (1 KB = 1000 B), matching what macOS Finder shows.
function formatBytes(bytes) {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1000 * 1000) return `${(bytes / 1000).toFixed(1)} KB`;
  return `${(bytes / (1000 * 1000)).toFixed(2)} MB`;
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

// Picks the output extension for a given input and format setting.
async function resolveOutputExt(filePath, outputFormat) {
  if (outputFormat === 'jpg') return '.jpg';
  if (outputFormat === 'png') return '.png';
  if (outputFormat === 'webp') return '.webp';
  // auto: PNGs without real transparency are treated as photos and converted to JPG.
  const ext = path.extname(filePath).toLowerCase();
  const isPng = ext === '.png';
  return isPng && !(await isAlphaUsed(filePath)) ? '.jpg' : ext;
}

// Runs the full sharp pipeline in memory and returns the encoded bytes.
// Shared by processImage (writes the result) and the web UI's live estimate (discards it),
// so the estimate is the exact size the real optimize will produce.
async function encodeImage(filePath, opts = {}) {
  const {
    quality = 80,
    maxWidth = null,
    maxHeight = null,
    outputFormat = 'auto', // 'auto' | 'jpg' | 'png' | 'webp'
    maxSizeKB = null,
  } = opts;

  const outputExt = await resolveOutputExt(filePath, outputFormat);

  // Returns a fresh sharp pipeline up to (but not including) the format encode step.
  function buildBase() {
    let p = sharp(filePath).rotate();
    if (maxWidth || maxHeight) {
      p = p.resize(maxWidth || null, maxHeight || null, {
        fit: 'inside',
        withoutEnlargement: true,
      });
    }
    return p;
  }

  function encode(q) {
    if (outputExt === '.jpg' || outputExt === '.jpeg') return buildBase().jpeg({ quality: q });
    if (outputExt === '.webp') return buildBase().webp({ quality: q });
    return buildBase().png({ compressionLevel: 9 });
  }

  // Binary-search quality to hit maxSizeKB target (JPG/WebP only — PNG is lossless).
  const isLossy = outputExt === '.jpg' || outputExt === '.jpeg' || outputExt === '.webp';
  let finalQuality = quality;
  if (maxSizeKB && isLossy) {
    const targetBytes = maxSizeKB * 1000;
    let lo = 1, hi = quality, bestQuality = 1;
    for (let i = 0; i < 8 && lo <= hi; i++) {
      const mid = Math.round((lo + hi) / 2);
      const buf = await encode(mid).toBuffer();
      if (buf.length <= targetBytes) {
        bestQuality = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    finalQuality = bestQuality;
  }

  const { data, info } = await encode(finalQuality).toBuffer({ resolveWithObject: true });
  return { buffer: data, outputExt, width: info.width, height: info.height, quality: finalQuality };
}

// originalBytes: size of the file the user actually supplied, when filePath is an
// intermediate (e.g. the JPG the web UI makes from a HEIC upload). Defaults to filePath's size.
async function processImage(filePath, newBasename, opts = {}) {
  const originalName = path.basename(filePath);
  const originalSize = opts.originalBytes || (await fs.promises.stat(filePath)).size;

  const { buffer, outputExt, width, height } = await encodeImage(filePath, opts);
  const outputPath = getUniqueOutputPath(newBasename, outputExt);
  await fs.promises.writeFile(outputPath, buffer);
  const newSize = buffer.length;

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
    width,
    height,
  };
}

// Map quality 1–100 to Ghostscript PDFSETTINGS preset.
function pdfPresetForQuality(q) {
  if (q < 40) return '/screen';   // 72 dpi
  if (q < 70) return '/ebook';    // 150 dpi
  if (q < 90) return '/printer';  // 300 dpi
  return '/prepress';             // 300 dpi, color-preserving
}

async function processPdf(filePath, newBasename, opts = {}) {
  const { quality = 80 } = opts;
  const originalName = path.basename(filePath);
  const originalSize = opts.originalBytes || (await fs.promises.stat(filePath)).size;
  const outputPath = getUniqueOutputPath(newBasename, '.pdf');
  const preset = pdfPresetForQuality(quality);

  try {
    await execFileP('gs', [
      '-sDEVICE=pdfwrite',
      '-dCompatibilityLevel=1.4',
      `-dPDFSETTINGS=${preset}`,
      '-dNOPAUSE',
      '-dQUIET',
      '-dBATCH',
      `-sOutputFile=${outputPath}`,
      filePath,
    ]);
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error('Ghostscript not found — install with `brew install ghostscript`');
    }
    throw new Error(`Ghostscript failed: ${err.stderr || err.message}`);
  }

  const { size: newSize } = await fs.promises.stat(outputPath);
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

// Dispatches to the right processor based on file extension.
async function processFile(filePath, newBasename, opts = {}) {
  const ext = path.extname(filePath).toLowerCase();
  if (PDF_EXTS.has(ext)) return processPdf(filePath, newBasename, opts);
  return processImage(filePath, newBasename, opts);
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
  encodeImage,
  formatBytes,
  processImage,
  processPdf,
  processFile,
  promptFilename,
  resolveName,
  logResult,
  INBOX_DIR,
  SUPPORTED_EXTS,
  PDF_EXTS,
};
