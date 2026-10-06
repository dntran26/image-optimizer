# Image Optimizer

A local image optimization factory with both a CLI and a web UI. Drop JPG, PNG, WebP, HEIC or PDF files in, get compressed, renamed, and properly formatted files out. Coworkers clone this repo and `git pull` updates, so keep `README.md` accurate for a non-developer.

## Getting started

```bash
npm install

# Web UI (localhost:8080)
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

- **JPG / WebP input**: compress at quality 80 (default), configurable via web UI quality slider
- **PNG with transparency**: keep as PNG, compress at level 9 lossless
- **PNG without transparency**: auto-convert to JPG (treated as a photo) — this is the "Auto" format mode
- **WebP output**: available as output format from web UI; uses same quality setting as JPG
- **HEIC/HEIF**: `server.js` converts to JPG on upload (web UI); sharp reads HEIC directly in the CLI. Savings are measured against the uploaded HEIC size (`originalBytes`), not the converted JPG
- **PDF**: Ghostscript (`gs`) with a preset picked from quality (`pdfPresetForQuality`); can grow small PDFs
- **Sizes**: decimal units (1 KB = 1000 B) to match Finder, in both `formatBytes` copies (`lib/processor.js`, `public/app.js`)
- **Resize**: optional max width/height (fit: inside, no upscaling)
- **Naming**: all filenames are kebab-cased; originals are moved to `inbox/processed/` after optimizing
- **Deduplication**: if an output filename already exists, `-2`, `-3` etc. are appended

## Port config

Server runs on **port 8080**. Change the `PORT` constant at the top of `server.js`.

## Code architecture

| File | Role |
|---|---|
| `lib/processor.js` | `processFile` dispatches to `processImage` (sharp) or `processPdf` (Ghostscript). `encodeImage` runs the sharp pipeline in memory and is shared by `processImage` and the web UI's `/estimate`, so the preview size is exactly the real output size. Used by both CLI and web. |
| `server.js` | Express backend. `POST /upload` saves to `uploads/` (HEIC converted, upright EXIF dims, `previewUrl` for HEIC thumbs), `GET /preview/:name` serves those thumbs, `POST /estimate` returns the exact output size without writing, `POST /optimize` calls `processFile`, `POST /zip` streams an archiver ZIP of optimized files. |
| `watch.js` | chokidar watcher on `images/inbox/`. Prompts for filename on each new file. |
| `process.js` | One-shot batch: scans inbox, loops through files with filename prompts. |
| `public/app.js` | All frontend logic: drag & drop, upload, card rendering, debounced live estimates, optimize, settings, drag-to-reorder, How it works panel, ZIP download. |
| `public/style.css` | Dark premium theme (Onest + IBM Plex Mono). Colour tokens on `:root` are contrast-checked against `--surface-2`; `--fill` drives the quality slider track. Help tooltips are CSS-only (`.tip[data-tip]`). |

## processFile / processImage opts

```js
processImage(filePath, newBasename, {
  quality: 80,           // JPG/WebP quality (1–100)
  maxWidth: null,        // px, optional
  maxHeight: null,       // px, optional
  outputFormat: 'auto',  // 'auto' | 'jpg' | 'png' | 'webp'
  maxSizeKB: null,       // KB (1000 B), binary-searches quality to fit; JPG/WebP only
  originalBytes: null,   // size to measure savings against when filePath is an intermediate (HEIC)
})
```

All opts are optional; omitting them matches the original CLI behavior exactly. PDFs use `quality` only.

## Releasing an update

Everyone's copy updates itself: `npm start` runs `scripts/update.js` first (the `prestart` script), which does `git pull --ff-only` and reinstalls only if `package.json`/`package-lock.json` changed. It never blocks startup. The server's `GET /update-check` compares the running `package.json` version with the one on the remote branch and the page shows a banner when it's newer.

So a push alone does NOT announce anything. To announce a release:
1. Bump `version` in `package.json` (and run `npm install --package-lock-only` so the lockfile matches).
2. Set `releaseNote` in `package.json`: one short line, it is the banner text.
3. Add the version to the patch notes in `public/index.html` (move the LATEST tag) and update the `#version-badge` fallback text.

Small fixes and doc edits can ship without a bump: they arrive on everyone's next restart, silently.

`PORT` env var overrides 8080 (handy for testing a second copy).
