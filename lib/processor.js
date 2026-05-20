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
    maxSizeKB = null,
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

  // Binary-search quality to hit maxSizeKB target (JPG/WebP only — PNG is lossless).
  // Uses toBuffer() so no temp files are created during the search.
  const isLossy = outputExt === '.jpg' || outputExt === '.jpeg' || outputExt === '.webp';
  let finalQuality = quality;
  if (maxSizeKB && isLossy) {
    const targetBytes = maxSizeKB * 1024;
    let lo = 1, hi = quality, bestQuality = 1;
    for (let i = 0; i < 8 && lo <= hi; i++) {
      const mid = Math.round((lo + hi) / 2);
      const encode = outputExt === '.webp'
        ? buildBase().webp({ quality: mid })
        : buildBase().jpeg({ quality: mid });
      const buf = await encode.toBuffer();
      if (buf.length <= targetBytes) {
        bestQuality = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    finalQuality = bestQuality;
  }

  // Final encode to output file
  let sharpInfo;
  if (outputExt === '.jpg' || outputExt === '.jpeg') {
    sharpInfo = await buildBase().jpeg({ quality: finalQuality }).toFile(outputPath);
  } else if (outputExt === '.webp') {
    sharpInfo = await buildBase().webp({ quality: finalQuality }).toFile(outputPath);
  } else {
    sharpInfo = await buildBase().png({ compressionLevel: 9 }).toFile(outputPath);
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
  const { size: originalSize } = await fs.promises.stat(filePath);
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
