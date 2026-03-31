# Image Optimizer

A local image optimization factory with both a CLI and a web UI. Drop JPGs and PNGs in, get compressed, renamed, and properly formatted files out.

## Getting started

```bash
npm install

# Web UI (localhost:3001)
npm start

# CLI — watch inbox/ for new files and process interactively
npm run watch

# CLI — manually batch-process everything currently in inbox/
npm run process
```

## Folder structure

```
images/
  inbox/           ← drop files here for CLI modes
  inbox/processed/ ← originals moved here after processing
  optimized/       ← all output files go here (CLI and web)
uploads/           ← temp storage for web UI uploads (auto-cleaned by processing)
lib/
  processor.js     ← all core processing logic (shared by CLI and web)
public/            ← web UI frontend (static files served by Express)
server.js          ← Express backend (web UI only)
watch.js           ← CLI file watcher
process.js         ← CLI manual batch processor
```

## File processing rules

- **JPG**: compress at quality 80 (default), configurable via web UI quality slider
- **PNG with transparency**: keep as PNG, compress at level 9 lossless
- **PNG without transparency**: auto-convert to JPG (treated as a photo) — this is the "Auto" format mode
- **WebP**: available as output format from web UI; uses same quality setting as JPG
- **Resize**: optional max width/height (fit: inside, no upscaling)
- **Naming**: all filenames are kebab-cased; originals are moved to `inbox/processed/` after optimizing
- **Deduplication**: if an output filename already exists, `-2`, `-3` etc. are appended

## Port config

Server runs on **port 3001**. Change the `PORT` constant at the top of `server.js`.

## Code architecture

| File | Role |
|---|---|
| `lib/processor.js` | Core sharp pipeline — `processImage(filePath, newBasename, opts?)` handles format detection, resize, compression, and file management. Used by both CLI and web. |
| `server.js` | Express backend. `POST /upload` saves to `uploads/`, `POST /optimize` calls `processImage`, `POST /zip` streams an archiver ZIP of optimized files. |
| `watch.js` | chokidar watcher on `images/inbox/`. Prompts for filename on each new file. |
| `process.js` | One-shot batch: scans inbox, loops through files with filename prompts. |
| `public/app.js` | All frontend logic — drag & drop, upload, card rendering, optimize, settings, drag-to-reorder, ZIP download. |
| `public/style.css` | Dark-theme styles. CSS custom property `--fill` drives the quality slider track. |

## processImage opts

```js
processImage(filePath, newBasename, {
  quality: 80,           // JPG/WebP quality (1–100)
  maxWidth: null,        // px, optional
  maxHeight: null,       // px, optional
  outputFormat: 'auto',  // 'auto' | 'jpg' | 'png' | 'webp'
})
```

All opts are optional — omitting them matches the original CLI behavior exactly.
