'use strict';

const express = require('express');
const multer = require('multer');
const archiver = require('archiver');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const heicConvert = require('heic-convert');
const { processFile, encodeImage, SUPPORTED_EXTS, PDF_EXTS } = require('./lib/processor');

const HEIC_EXTS = new Set(['.heic', '.heif']);

const app = express();
const PORT = 8080;

const UPLOADS_DIR = path.resolve('./uploads');
const OPTIMIZED_DIR = path.resolve('./images/optimized');

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    cb(null, `${unique}${path.extname(file.originalname).toLowerCase()}`);
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, SUPPORTED_EXTS.has(ext));
  },
});

app.use(express.json());
app.use(express.static('public'));
app.use('/optimized', express.static(OPTIMIZED_DIR));

// Upload a file — saves to uploads/, returns tempPath + metadata + dimensions
app.post('/upload', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No valid image uploaded' });

  // Convert HEIC/HEIF to JPG before passing through the pipeline
  const uploadedExt = path.extname(req.file.path).toLowerCase();
  if (HEIC_EXTS.has(uploadedExt)) {
    try {
      const inputBuffer = await fs.promises.readFile(req.file.path);
      const outputBuffer = await heicConvert({ buffer: inputBuffer, format: 'JPEG', quality: 1 });
      const jpgPath = req.file.path.replace(/\.[^.]+$/, '.jpg');
      await fs.promises.writeFile(jpgPath, Buffer.from(outputBuffer));
      await fs.promises.unlink(req.file.path);
      req.file.path = jpgPath;
    } catch (err) {
      return res.status(422).json({ error: `HEIC conversion failed: ${err.message}` });
    }
  }

  const finalExt = path.extname(req.file.path).toLowerCase();
  const isPdf = PDF_EXTS.has(finalExt);

  let width = null, height = null;
  if (!isPdf) {
    try {
      const meta = await sharp(req.file.path).metadata();
      // EXIF orientations 5-8 are rotated 90°, so the upright image has width and height swapped.
      // Report the upright size, since that's what the pipeline (which auto-rotates) works from.
      const swap = (meta.orientation ?? 1) >= 5;
      width = (swap ? meta.height : meta.width) ?? null;
      height = (swap ? meta.width : meta.height) ?? null;
    } catch (err) {
      console.error('sharp metadata error:', err.message);
    }
  }

  res.json({
    tempPath: req.file.path,
    originalName: req.file.originalname,
    originalSizeBytes: req.file.size,
    width,
    height,
    isPdf,
    // Most browsers can't display HEIC, so the card swaps to the converted JPG for its thumbnail
    previewUrl: HEIC_EXTS.has(uploadedExt) ? `/preview/${path.basename(req.file.path)}` : null,
  });
});

// Serves an uploaded file for thumbnail previews (only from uploads/, by bare filename)
app.get('/preview/:name', (req, res) => {
  const full = path.join(UPLOADS_DIR, path.basename(req.params.name));
  if (!fs.existsSync(full)) return res.status(404).end();
  res.sendFile(full);
});

// Optimize a previously uploaded file
app.post('/optimize', async (req, res) => {
  const { tempPath, originalName, newName, quality, maxWidth, maxHeight, outputFormat, maxSizeKB } = req.body;

  if (!tempPath || !fs.existsSync(tempPath)) {
    return res.status(400).json({ error: 'Upload not found — re-upload the file and try again' });
  }

  try {
    // Savings are measured against the file the user uploaded. For HEIC that differs from
    // tempPath, which is the (much larger) JPG made by the conversion in /upload.
    const originalSizeBytes = parseInt(req.body.originalSizeBytes, 10)
      || (await fs.promises.stat(tempPath)).size;

    const opts = {
      originalBytes: originalSizeBytes,
      quality: quality != null ? parseInt(quality, 10) : 80,
      maxWidth: maxWidth ? parseInt(maxWidth, 10) : null,
      maxHeight: maxHeight ? parseInt(maxHeight, 10) : null,
      outputFormat: outputFormat || 'auto',
      maxSizeKB: maxSizeKB ? parseInt(maxSizeKB, 10) : null,
    };

    const result = await processFile(tempPath, newName, opts);
    const newFilePath = path.join(OPTIMIZED_DIR, result.newName);
    const newSizeBytes = (await fs.promises.stat(newFilePath)).size;
    const savedBytes = originalSizeBytes - newSizeBytes;
    const savedPct = parseFloat(((savedBytes / originalSizeBytes) * 100).toFixed(1));

    res.json({
      ...result,
      originalName: originalName || result.originalName,
      downloadUrl: `/optimized/${encodeURIComponent(result.newName)}`,
      originalSizeBytes,
      newSizeBytes,
      savedBytes,
      savedPct,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Live size estimate: runs the real pipeline in memory and reports the exact output size.
// Nothing is written and the upload is left in place.
app.post('/estimate', async (req, res) => {
  const { tempPath, quality, maxWidth, maxHeight, outputFormat, maxSizeKB } = req.body;
  const resolved = tempPath && path.resolve(tempPath);
  if (!resolved || !resolved.startsWith(UPLOADS_DIR + path.sep) || !fs.existsSync(resolved)) {
    return res.status(400).json({ error: 'Upload not found' });
  }
  if (PDF_EXTS.has(path.extname(resolved).toLowerCase())) {
    return res.status(400).json({ error: 'No estimate for PDFs' });
  }
  try {
    const { buffer, outputExt, width, height } = await encodeImage(resolved, {
      quality: quality != null ? parseInt(quality, 10) : 80,
      maxWidth: maxWidth ? parseInt(maxWidth, 10) : null,
      maxHeight: maxHeight ? parseInt(maxHeight, 10) : null,
      outputFormat: outputFormat || 'auto',
      maxSizeKB: maxSizeKB ? parseInt(maxSizeKB, 10) : null,
    });
    res.json({ sizeBytes: buffer.length, outputExt, width, height });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bundle optimized files into a ZIP for bulk download
app.post('/zip', async (req, res) => {
  const { files } = req.body;

  if (!Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ error: 'No files specified' });
  }

  // Resolve and validate each path — only allow files inside OPTIMIZED_DIR
  const resolved = files
    .map(name => ({ name: path.basename(name), full: path.join(OPTIMIZED_DIR, path.basename(name)) }))
    .filter(({ full }) => fs.existsSync(full));

  if (resolved.length === 0) {
    return res.status(404).json({ error: 'None of the specified files were found' });
  }

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="optimized-images.zip"');

  const archive = archiver('zip', { zlib: { level: 9 } });

  archive.on('error', (err) => {
    console.error('archiver error:', err);
    if (!res.headersSent) res.status(500).end();
  });

  archive.pipe(res);

  for (const { full, name } of resolved) {
    archive.file(full, { name });
  }

  await archive.finalize();
});

app.listen(PORT, () => {
  console.log(`\nImage Optimizer UI → http://localhost:${PORT}\n`);
});
