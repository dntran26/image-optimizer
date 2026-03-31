# Image Optimizer

Compress and rename JPG/PNG images from a drop folder. Prompts you for a kebab-case filename, compresses, and moves the original out of the way.

## Folder structure

```
images/
  inbox/           ← drop raw images here
    processed/     ← originals are moved here after handling
  optimized/       ← compressed output lands here
```

## Setup

```bash
cd image-optimizer
npm install
```

> Requires Node.js 18+. `sharp` compiles a native binary on first install.

---

## Two modes

### Watch mode — auto-detects new files

```bash
npm run watch
```

Keeps running and watches `./images/inbox/`. When you drop in a new image it immediately prompts you:

```
New file: hero-banner-raw.png
  New name (Enter to skip): Hero Banner
  ✓  hero-banner-raw.png  →  hero-banner.png
     1.23 MB  →  890.4 KB  (saved 334.0 KB (27.1%))
```

If you press Enter without typing, the file is left in the inbox untouched. Stop watching with `Ctrl+C`.

Multiple files dropped at once are queued and handled one at a time so prompts never overlap.

---

### Manual mode — process everything in the inbox at once

```bash
npm run process
```

Scans `./images/inbox/` for all JPGs and PNGs and loops through them:

```
Found 3 image(s) in ./images/inbox/

File: screenshot-2024.png
  New name (Enter to skip): App Screenshot
  ✓  →  app-screenshot.png
     2.10 MB  →  1.45 MB  (saved 651.2 KB (31.0%))

File: photo.jpg
  New name (Enter to skip):
  Skipped.

Done.  |  Processed: 1  |  Skipped: 2
```

---

## Processing rules

| Setting | Value |
|---|---|
| JPG quality | 80% |
| PNG compression | lossless, level 9 |
| Resize | Never — original dimensions kept |
| Format | Original format preserved (JPG→JPG, PNG→PNG) |
| Duplicate names | Appended with `-2`, `-3`, etc. (e.g. `hero-banner-2.png`) |

## Kebab-case conversion examples

| You type | Output filename |
|---|---|
| `Hero Banner` | `hero-banner.png` |
| `App Screenshot 2` | `app-screenshot-2.png` |
| `CTA_button_dark` | `cta-button-dark.jpg` |
| `logo (final)` | `logo-final.svg` |

Special characters are stripped; spaces and underscores become dashes.
