# Image Optimizer

Compress, resize, convert and rename images (and PDFs) for the web. It runs on your own Mac, so client files never leave your machine.

## Setup (once)

You need:
- [Node.js](https://nodejs.org) 18 or newer
- [Homebrew](https://brew.sh), for the two installs below
- Access to the Nimble-Digital GitHub org (the repo is private)

**1. Log in to GitHub from Terminal.** The repo is private, so git needs your login, and GitHub no longer accepts your password there. This saves your login once, for the download and for every automatic update after it:

```bash
brew install gh
gh auth login --git-protocol https
gh auth setup-git
```

`gh auth login` asks a few questions: pick GitHub.com, then log in with a web browser.

**2. Download and install:**

```bash
git clone https://github.com/Nimble-Digital/image-optimizer.git
cd image-optimizer
npm install
```

**3. PDF support (optional).** PDF optimization needs Ghostscript. Skip this if you only do images:

```bash
brew install ghostscript
```

## Use it

```bash
npm start
```

Then open **http://localhost:8080**. Leave the terminal window open while you use it; `Ctrl+C` stops it.

1. **Drop files in.** JPG, PNG, WebP, HEIC (iPhone photos) or PDF, as many as you like.
2. **Optimize** one card, or **Optimize All**. Each card shows the exact size it will be before you do, and it updates live as you change settings.
3. **Download** files one by one, or **Download All as ZIP**. Copies are also saved in `images/optimized/`.

That's it. Everything below is optional.

Settings, Optimize All and a short **Handy extras** list sit in a sidebar that follows you as you scroll. A `?` next to each setting explains what it does.

### Settings

| Setting | What it does |
|---|---|
| Quality | Higher keeps more detail, lower makes smaller files. 80 is a good default for photos. |
| Max size | Shrinks anything larger to fit inside this width and/or height, keeping proportions. Never enlarges. |
| Max file size | Finds the highest quality that fits under this many KB. JPG and WebP only. |
| Format | **Auto** keeps the original format, except PNGs with no transparency, which become JPG (they are usually photos). Or force JPG, PNG or WebP. |
| Prefix + Starting # | Renames the whole queue as `prefix-1`, `prefix-2` and so on, in card order. Starting # carries on from an earlier batch. |

### Optional extras

- **Rename:** click a filename and type. Whatever you type is cleaned up to lowercase-with-dashes (`Hero Banner` becomes `hero-banner`).
- **Drag cards to reorder** them by the dots on the preview. With a prefix set, the numbering follows the new order.
- **Per-file resize:** the W and H boxes on a card override the global max size for that file only.
- **Before and after:** every finished card shows the old and new size, a size bar and the percentage saved.
- File sizes use the same units as Finder (1 MB = 1,000,000 bytes), so the numbers match what you see on your Mac.

## Getting updates

Updates install themselves: every time you start the app with `npm start`, it checks GitHub first and pulls the latest version. When a new version comes out while the app is open, a bar at the top says so. Press `Ctrl+C` in Terminal and run `npm start` again to get it. The version badge in the header lists what changed.

If the update can't run (offline, no GitHub access, or you've edited files yourself), it says so and starts the version you have. To update by hand:

```bash
cd image-optimizer
git pull
npm install
```

## Housekeeping

Three folders fill up over time. Clear them out now and then:
- `images/inbox/processed/`: every original you optimize is moved here (web uploads get random names).
- `uploads/`: files you dropped in but never optimized, or removed from the queue.
- `images/optimized/`: a copy of every output.

All three are ignored by git, so nothing you process is ever committed.

## If something's off

- **`Error: listen EADDRINUSE: address already in use :::8080`** when starting: the app is already running in another Terminal window. Use that one, or press `Ctrl+C` there first. To run a second copy anyway: `PORT=8081 npm start`.
- **"Checking for updates... skipped"**: the message after it says why. Usually you're offline, your GitHub login isn't saved (redo step 1 of Setup), or you've edited the app's files yourself. The app still starts on the version you have.
- **The page won't load**: check the Terminal window is still open and shows `Image Optimizer UI → http://localhost:8080`. If it closed, run `npm start` again from the `image-optimizer` folder.
- **A transparent logo came out with a black background**: you picked JPG, which can't store transparency. Switch Format back to Auto, which keeps it as PNG or WebP.

---

## Developer notes

### Command-line modes

These work off `images/inbox/` and write to `images/optimized/`, using the default settings (quality 80, Auto format, no resize).

**Watch mode** prompts you for a name each time a file lands in the inbox:

```bash
npm run watch
```

```
New file: hero-banner-raw.png
  New name (Enter to keep original, "skip" to skip): Hero Banner
  ✓  hero-banner-raw.png  →  hero-banner.png
     1.23 MB  →  890.4 KB  (saved 339.6 KB (27.6%))
```

Files dropped at the same time are queued, so prompts never overlap. `Ctrl+C` stops it.

**Batch mode** loops through everything already in the inbox:

```bash
npm run process
```

At the prompt, **Enter** keeps the original name (kebab-cased) and `skip` leaves the file in the inbox untouched.

### Processing rules

| Input | What happens |
|---|---|
| JPG / WebP | Re-encoded at the chosen quality, in the same format unless you pick another. |
| PNG with transparency | Kept as PNG, lossless compression level 9. |
| PNG without transparency | Becomes JPG in Auto mode. |
| Transparent PNG / WebP forced to JPG | JPG can't store transparency, so the see-through areas come out black. Auto mode never does this; it keeps transparent files in their own format. |
| HEIC / HEIF | Converted to JPG first, then optimized. Savings are measured against the original HEIC. |
| PDF | Run through Ghostscript. Quality picks the preset: under 40 `/screen`, 40 to 69 `/ebook`, 70 to 89 `/printer`, 90+ `/prepress`. Small or already-optimized PDFs can come out larger. |
| All images | Auto-rotated from the camera's EXIF orientation. Duplicate names get `-2`, `-3` and so on. |

### Filename cleanup

| You type | Output filename |
|---|---|
| `Hero Banner` | `hero-banner.jpg` |
| `App Screenshot 2` | `app-screenshot-2.png` |
| `CTA_button_dark` | `cta-button-dark.jpg` |
| `logo (final)` | `logo-final.png` |

Special characters are stripped; spaces and underscores become dashes.
