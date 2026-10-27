# Press

Nimble's image prep tool: drop images in, get smaller, renamed, web-ready files out.

Compress, resize, convert and rename images (and PDFs) for the web. It runs on your own Mac, so client files never leave your machine.

## Setup (once)

This takes about ten minutes and you only do it once. Everything happens in **Terminal**, the app that lets you type commands to your Mac. Open it from Spotlight: press `Cmd+Space`, type `Terminal`, press Enter. A white or black window appears with a blinking cursor. That's where you paste the commands below, one block at a time, pressing Enter after each.

Two things to know before you start:
- Commands run in a folder, like Finder has a current folder. Terminal starts in your home folder (the one with Desktop, Documents and Downloads in it).
- If a popup asks to install "command line developer tools", click **Install** and wait for it to finish, then run the command again.

**1. Install Homebrew.** It installs the other tools. Paste this and press Enter; it asks for your Mac password (nothing shows while you type it, that's normal) and takes a few minutes:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

When it finishes it prints a **Next steps** section with two commands starting `echo` and `eval`. Copy and run those too, or Terminal won't find `brew`.

**2. Install Node, the GitHub tool and Ghostscript:**

```bash
brew install node gh ghostscript
```

(Node runs the app, `gh` logs you in to GitHub, Ghostscript handles PDFs.)

**3. Get access to the code.** The repo is private, so you need a GitHub account that is in the Nimble-Digital organisation. If you don't have one, make a free account at https://github.com, then ask Danny to add you. Wait for the invite email and accept it before the next step.

**4. Log in to GitHub from Terminal.** This saves your login once, for the download and for every automatic update after it:

```bash
gh auth login --git-protocol https
gh auth setup-git
```

`gh auth login` asks a few questions. Answer: **GitHub.com**, **Yes** to authenticate Git, **Login with a web browser**. It shows a one-time code; press Enter, paste the code into the browser page that opens, and approve.

**5. Download the app:**

```bash
git clone https://github.com/Nimble-Digital/image-optimizer.git
cd image-optimizer
npm install
```

This makes an `image-optimizer` folder in your home folder and installs what it needs. You can see it in Finder next to Desktop and Documents.

## Use it

Every time you want to use it, open Terminal and run:

```bash
cd image-optimizer
npm start
```

Then open **http://localhost:8080** in your browser. Leave the Terminal window open while you use the app. To stop it, click the Terminal window and press `Control+C` (Control, not Command).

1. **Drop files in.** JPG, PNG, WebP, AVIF, HEIC (iPhone photos) or PDF, as many as you like. Drop them anywhere on the page, or paste a screenshot with Cmd+V.
2. **Optimize** one card, or **Optimize All**. Each card shows the exact size it will be before you do, and it updates live as you change settings.
3. **Download** files one by one, or **Download All as ZIP**. Copies are also saved in `images/optimized/` (**Show in Finder** opens that folder).

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

Updates install themselves: every time you start the app with `npm start`, it checks GitHub first and pulls the latest version. When a new version comes out while the app is open, a bar at the top says so. Press `Control+C` in Terminal and run `npm start` again to get it. The version badge in the header lists what changed.

If the update can't run (offline, no GitHub access, or you've edited files yourself), it says so and starts the version you have. To update by hand, in Terminal:

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

- **`Error: listen EADDRINUSE: address already in use :::8080`** when starting: the app is already running in another Terminal window. Use that one, or press `Control+C` there first. To run a second copy anyway: `PORT=8081 npm start`.
- **"Checking for updates... skipped"**: the message after it says why. Usually you're offline, your GitHub login isn't saved (redo step 1 of Setup), or you've edited the app's files yourself. The app still starts on the version you have.
- **The page won't load**: check the Terminal window is still open and shows `Press → http://localhost:8080`. If it closed, open Terminal and run `cd image-optimizer` then `npm start` again.
- **`command not found: brew`** or **`npm`**: Terminal can't see Homebrew. Rerun the two **Next steps** commands Homebrew printed at the end of its install (or close Terminal and open it again), then try again.
- **`cd: no such file or directory: image-optimizer`**: Terminal isn't in your home folder. Run `cd ~` first, then `cd image-optimizer`.
- **Asked for a GitHub username and password** when starting: your login isn't saved. Run `gh auth setup-git` and try again.
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

Files dropped at the same time are queued, so prompts never overlap. `Control+C` stops it.

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
| AVIF | Becomes a JPG on Auto (PNG if it uses transparency), resized if you set a max size. Pick WebP or PNG in Format to convert to those instead. |
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
