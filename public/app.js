'use strict';

// ── Globals ───────────────────────────────────────────────────────────────────
let totalProcessed = 0;
let totalSavedBytes = 0;
let cardIdCounter = 0;
let dragSrc = null;
let tipsMode = 'auto';

// ── Helpers ───────────────────────────────────────────────────────────────────
// Grows a name box to fit its whole value (long names wrap instead of being cut off)
function fitName(el) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

function toKebabCase(str) {
  return str
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s\-_]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// Decimal units (1 KB = 1000 B), matching what macOS Finder shows.
function formatBytes(bytes) {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1000 * 1000) return `${(bytes / 1000).toFixed(1)} KB`;
  return `${(bytes / (1000 * 1000)).toFixed(2)} MB`;
}

let shownSavedBytes = 0;
function updateStats() {
  document.getElementById('stat-count').textContent = totalProcessed;
  const el = document.getElementById('stat-saved');
  const from = shownSavedBytes, to = Math.max(0, totalSavedBytes), start = performance.now();
  shownSavedBytes = to;
  const tick = (now) => {
    const t = Math.min(1, (now - start) / 600);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = formatBytes(Math.round(from + (to - from) * eased));
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ── Size estimate ─────────────────────────────────────────────────────────────
// Asks the server to run the real pipeline in memory (/estimate), so the number shown
// is the exact size Optimize will produce. Debounced per card; stale replies are dropped.
const estimateTimers = new WeakMap();
const estimateSeq = new WeakMap();

function updateEstimate(card) {
  const el = card.querySelector('.size-estimate');
  if (!el) return;

  // PDFs don't get an estimate, and done cards show their real result instead
  if (card.classList.contains('is-pdf') || card.classList.contains('done') || !card.dataset.tempPath) {
    el.classList.add('hidden');
    return;
  }

  el.classList.remove('hidden');
  el.classList.add('is-loading');
  clearTimeout(estimateTimers.get(card));
  estimateTimers.set(card, setTimeout(() => fetchEstimate(card, el), 350));
}

async function fetchEstimate(card, el) {
  const seq = (estimateSeq.get(card) || 0) + 1;
  estimateSeq.set(card, seq);
  const originalSize = parseInt(card.dataset.originalSizeBytes, 10);
  const { quality, maxWidth, maxHeight, outputFormat, maxSizeKB } = getCardSettings(card);

  try {
    const res = await fetch('/estimate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tempPath: card.dataset.tempPath, quality, maxWidth, maxHeight, outputFormat, maxSizeKB }),
    });
    const data = await res.json();
    if (estimateSeq.get(card) !== seq || card.classList.contains('done')) return;
    if (!res.ok) throw new Error(data.error);

    const pct = (originalSize - data.sizeBytes) / originalSize * 100;
    const cls = pct >= 30 ? 'est-great' : pct >= 10 ? 'est-ok' : pct < 0 ? 'est-grew' : '';
    const pctText = `${pct >= 0 ? '−' : '+'}${Math.abs(pct).toFixed(0)}%`;
    const natW = parseInt(card.dataset.natW, 10) || 0;
    const resized = natW && data.width !== natW;
    el.innerHTML = `<span class="meta-label">Will be</span> <strong>${formatBytes(data.sizeBytes)}</strong>`
      + ` <span class="${cls}">${pctText}</span>`
      + `<span class="est-detail">${data.outputExt}${resized ? ` · ${data.width} × ${data.height}` : ''}</span>`;
    el.classList.remove('is-loading');
  } catch {
    if (estimateSeq.get(card) !== seq) return;
    el.classList.add('hidden');
  }
}

function updateAllEstimates() {
  document.querySelectorAll('.image-card:not(.done)').forEach(updateEstimate);
}

// ── Settings ──────────────────────────────────────────────────────────────────
function getSettings() {
  const quality = parseInt(document.getElementById('quality-input').value, 10);
  const maxWidth = parseInt(document.getElementById('max-width').value, 10) || null;
  const maxHeight = parseInt(document.getElementById('max-height').value, 10) || null;
  const outputFormat = document.querySelector('.format-btn.active').dataset.format;
  const prefix = toKebabCase(document.getElementById('prefix-input').value);
  const maxSizeKB = parseInt(document.getElementById('max-filesize').value, 10) || null;
  return { quality, maxWidth, maxHeight, outputFormat, prefix, maxSizeKB };
}

function getCardSettings(card) {
  const global = getSettings();
  const cardW = parseInt(card.querySelector('.card-w-input').value, 10) || null;
  const cardH = parseInt(card.querySelector('.card-h-input').value, 10) || null;
  return {
    ...global,
    maxWidth:  cardW  !== null ? cardW  : global.maxWidth,
    maxHeight: cardH !== null ? cardH : global.maxHeight,
  };
}

// Quality slider — update fill track + label
const qualityInput = document.getElementById('quality-input');
const qualityValue = document.getElementById('quality-value');

function syncQualitySlider() {
  const pct = ((qualityInput.value - 1) / 99) * 100;
  qualityInput.style.setProperty('--fill', `${pct.toFixed(1)}%`);
  qualityValue.textContent = qualityInput.value;
}

qualityInput.addEventListener('input', () => { syncQualitySlider(); updateAllEstimates(); });
syncQualitySlider();

// Format selector
document.getElementById('format-selector').addEventListener('click', (e) => {
  const btn = e.target.closest('.format-btn');
  if (!btn) return;
  document.querySelectorAll('.format-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  updateAllEstimates();
});

// Resize inputs
document.getElementById('max-width').addEventListener('input', updateAllEstimates);
document.getElementById('max-height').addEventListener('input', updateAllEstimates);
document.getElementById('max-filesize').addEventListener('input', updateAllEstimates);

// ── Prefix ────────────────────────────────────────────────────────────────────
// Renumbers every non-done, non-in-flight card in DOM order.
// If prefix is empty, reverts each card to its stored baseName.
function applyPrefix() {
  const prefix = toKebabCase(document.getElementById('prefix-input').value);
  const startNum = Math.max(1, parseInt(document.getElementById('start-number-input').value, 10) || 1);
  const cards = Array.from(
    document.querySelectorAll('#image-list .image-card:not(.done)')
  );
  let n = startNum;
  cards.forEach(card => {
    const inp = card.querySelector('.name-input');
    if (!inp || inp.disabled) return; // skip cards mid-optimization
    inp.value = prefix ? `${prefix}-${n++}` : (card.dataset.baseName || '');
    fitName(inp);
  });
}

document.getElementById('prefix-input').addEventListener('input', applyPrefix);
document.getElementById('start-number-input').addEventListener('input', applyPrefix);

// ── Progress bar ──────────────────────────────────────────────────────────────
function startProgress(bar) {
  bar.style.transition = 'width 2s cubic-bezier(0.4, 0, 0.2, 1)';
  bar.offsetWidth; // force reflow
  bar.style.width = '75%';
}

function completeProgress(bar) {
  bar.style.transition = 'width 0.25s ease';
  bar.style.width = '100%';
}

// ── Toolbar visibility ────────────────────────────────────────────────────────
function refreshToolbar() {
  const list = document.getElementById('image-list');
  const toolbar = document.getElementById('toolbar');
  const zipBtn = document.getElementById('btn-download-zip');
  const hasCards = list.children.length > 0;
  const hasDone = list.querySelector('.image-card.done') !== null;
  toolbar.classList.toggle('hidden', !hasCards);
  zipBtn.classList.toggle('hidden', !hasDone);

  const total = list.children.length;
  const done = list.querySelectorAll('.image-card.done').length;
  document.getElementById('queue-count').textContent =
    `${total} file${total === 1 ? '' : 's'}${done ? ` · ${done} done` : ''}`;

  // Tips show on an empty queue unless the button closed them, or whenever the button opened them
  const tips = document.getElementById('tips');
  const show = tipsMode === 'open' || (tipsMode === 'auto' && !hasCards);
  tips.classList.toggle('hidden', !show);
  const btn = document.getElementById('help-toggle');
  btn.classList.toggle('active', show);
  btn.setAttribute('aria-expanded', String(show));
}

// ── Drag to reorder ───────────────────────────────────────────────────────────
function initDragReorder(card) {
  card.setAttribute('draggable', 'true');

  // Disable card draggability while editing the name input so text selection works
  const nameInput = card.querySelector('.name-input');
  nameInput.addEventListener('focus', () => card.setAttribute('draggable', 'false'));
  nameInput.addEventListener('blur',  () => card.setAttribute('draggable', 'true'));

  card.addEventListener('dragstart', (e) => {
    dragSrc = card;
    e.dataTransfer.effectAllowed = 'move';
    // Defer adding class so the ghost image captures the normal state
    setTimeout(() => card.classList.add('dragging'), 0);
  });

  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    document.querySelectorAll('.image-card.drag-target')
      .forEach(c => c.classList.remove('drag-target'));
    dragSrc = null;
  });

  card.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!dragSrc || card === dragSrc) return;
    e.dataTransfer.dropEffect = 'move';
    document.querySelectorAll('.image-card.drag-target')
      .forEach(c => c.classList.remove('drag-target'));
    card.classList.add('drag-target');
  });

  card.addEventListener('dragleave', (e) => {
    if (!card.contains(e.relatedTarget)) {
      card.classList.remove('drag-target');
    }
  });

  card.addEventListener('drop', (e) => {
    e.preventDefault();
    if (!dragSrc || card === dragSrc) return;
    const items = [...document.getElementById('image-list').children];
    const srcIdx = items.indexOf(dragSrc);
    const tgtIdx = items.indexOf(card);
    if (srcIdx < tgtIdx) card.after(dragSrc);
    else card.before(dragSrc);
    card.classList.remove('drag-target');
    applyPrefix(); // keep prefix numbers in sync with new order
  });
}

// ── Build a card DOM node ─────────────────────────────────────────────────────
function buildCard(file, localUrl) {
  const id = ++cardIdCounter;
  const baseName = toKebabCase(file.name.replace(/\.[^.]+$/, '')) || `image-${id}`;
  const ext = (file.name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
  const isPdf = ext === '.pdf';

  const li = document.createElement('li');
  li.className = 'image-card' + (isPdf ? ' is-pdf' : '');
  li.id = `card-${id}`;

  const thumb = isPdf
    ? `<div class="pdf-thumb"><svg width="32" height="40" viewBox="0 0 32 40" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M5 1h16l6 6v32H5z"/><path d="M21 1v6h6"/></svg><span class="pdf-label">PDF</span></div>`
    : `<img src="${localUrl}" alt="">`;

  li.innerHTML = `
    <div class="card-thumb">
      ${thumb}
      <div class="drag-handle" title="Drag to reorder">
        <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor">
          <circle cx="2.5" cy="3"  r="1.4"/>
          <circle cx="7.5" cy="3"  r="1.4"/>
          <circle cx="2.5" cy="8"  r="1.4"/>
          <circle cx="7.5" cy="8"  r="1.4"/>
          <circle cx="2.5" cy="13" r="1.4"/>
          <circle cx="7.5" cy="13" r="1.4"/>
        </svg>
      </div>
      <button class="btn-remove" title="Remove">&times;</button>
      <span class="save-pill hidden"></span>
    </div>
    <div class="card-body">
      <div class="card-name-row">
        <label class="name-field" title="Click to rename">
          <textarea class="name-input" rows="1" spellcheck="false" aria-label="File name">${baseName}</textarea>
          <svg class="name-edit-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
        </label>
        <span class="ext-badge">${ext}</span>
      </div>
      <div class="card-meta">
        <span class="orig-size">${formatBytes(file.size)}<span class="orig-dims"></span></span>
        <span class="upload-status">Uploading…</span>
      </div>
      <div class="size-estimate hidden"></div>
      <div class="card-resize-row">
        <span class="resize-label">Resize</span>
        <input type="number" class="card-w-input num-input-sm" placeholder="W" min="1" max="99999">
        <span class="size-sep">×</span>
        <input type="number" class="card-h-input num-input-sm" placeholder="H" min="1" max="99999">
        <span class="size-unit">px</span>
      </div>
      <div class="progress-wrap hidden">
        <div class="progress-bar"></div>
      </div>
      <div class="card-result hidden"></div>
      <div class="card-actions">
        <button class="btn-optimize" disabled>Optimize</button>
        <a class="btn-download hidden" download>Download</a>
      </div>
    </div>
  `;

  // Capture natural dimensions once the thumbnail loads (needed for resize estimates).
  // This fires almost immediately for blob URLs and acts as a fallback before the
  // upload response arrives.
  li.dataset.ext = ext;
  li.dataset.baseName = baseName; // revert target when prefix is cleared

  if (isPdf) {
    // PDFs have no image dimensions and no resize/format options apply
    li.querySelector('.card-resize-row').classList.add('hidden');
    li.querySelector('.size-estimate').classList.add('hidden');
  } else {
    const img = li.querySelector('img');
    img.addEventListener('load', () => {
      if (img.naturalWidth > 0) {
        li.dataset.natW = img.naturalWidth;
        li.dataset.natH = img.naturalHeight;
        const dimsEl = li.querySelector('.orig-dims');
        if (!dimsEl.textContent) {
          dimsEl.textContent = ` · ${img.naturalWidth} × ${img.naturalHeight} px`;
        }
      }
    });
  }

  // Remove button
  li.querySelector('.btn-remove').addEventListener('click', () => {
    li.remove();
    applyPrefix();
    refreshToolbar();
  });

  // Kebab-case the name field on blur.
  // When no prefix is active, also update baseName so manual renames persist.
  const nameInput = li.querySelector('.name-input');
  nameInput.addEventListener('blur', () => {
    const kebab = toKebabCase(nameInput.value) || li.dataset.baseName;
    nameInput.value = kebab;
    fitName(nameInput);
    const activePrefix = toKebabCase(document.getElementById('prefix-input').value);
    if (!activePrefix) {
      li.dataset.baseName = kebab;
    }
  });

  // It's a wrapping textarea, but a filename is one line: Enter confirms instead of adding a newline
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); nameInput.blur(); }
  });
  nameInput.addEventListener('input', () => {
    if (nameInput.value.includes('\n')) nameInput.value = nameInput.value.replace(/\n/g, ' ');
    fitName(nameInput);
  });
  requestAnimationFrame(() => fitName(nameInput)); // once it's in the DOM and has a width

  // Per-card resize inputs — update estimate on change, disable drag on focus
  const cardWInput = li.querySelector('.card-w-input');
  const cardHInput = li.querySelector('.card-h-input');
  cardWInput.addEventListener('input', () => updateEstimate(li));
  cardHInput.addEventListener('input', () => updateEstimate(li));
  cardWInput.addEventListener('focus', () => li.setAttribute('draggable', 'false'));
  cardWInput.addEventListener('blur',  () => li.setAttribute('draggable', 'true'));
  cardHInput.addEventListener('focus', () => li.setAttribute('draggable', 'false'));
  cardHInput.addEventListener('blur',  () => li.setAttribute('draggable', 'true'));

  initDragReorder(li);
  return li;
}

// ── Upload a file to the server ───────────────────────────────────────────────
async function uploadFile(file, card) {
  const statusEl  = card.querySelector('.upload-status');
  const optimizeBtn = card.querySelector('.btn-optimize');

  try {
    const fd = new FormData();
    fd.append('image', file);
    const res = await fetch('/upload', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');

    card.dataset.tempPath = data.tempPath;
    card.dataset.originalName = data.originalName;
    card.dataset.originalSizeBytes = data.originalSizeBytes;
    if (data.previewUrl) card.querySelector('.card-thumb img').src = data.previewUrl;
    if (data.width && data.height) {
      card.dataset.natW = data.width;
      card.dataset.natH = data.height;
      card.querySelector('.orig-dims').textContent = ` · ${data.width} × ${data.height} px`;
    }

    statusEl.textContent = '';
    optimizeBtn.disabled = false;
    updateEstimate(card);
  } catch (err) {
    statusEl.textContent = `Upload failed: ${err.message}`;
    statusEl.classList.add('error');
  }
}

// ── Optimize a single card ────────────────────────────────────────────────────
async function optimizeCard(card, { fireConfetti = true } = {}) {
  // Skip cards that are already done, errored, or mid-flight
  if (card.classList.contains('done')) return;
  const optimizeBtn = card.querySelector('.btn-optimize');
  if (optimizeBtn.disabled && !card.dataset.tempPath) return; // still uploading

  const nameInput    = card.querySelector('.name-input');
  const extBadge     = card.querySelector('.ext-badge');
  const statusEl     = card.querySelector('.upload-status');
  const progressWrap = card.querySelector('.progress-wrap');
  const progressBar  = card.querySelector('.progress-bar');
  const resultEl     = card.querySelector('.card-result');
  const downloadBtn  = card.querySelector('.btn-download');

  const { quality, maxWidth, maxHeight, outputFormat, maxSizeKB } = getCardSettings(card);
  const newName = toKebabCase(nameInput.value) ||
    toKebabCase(card.dataset.originalName || 'image');
  nameInput.value = newName;
  fitName(nameInput);

  // Lock UI
  optimizeBtn.disabled = true;
  nameInput.disabled = true;
  card.querySelector('.card-w-input').disabled = true;
  card.querySelector('.card-h-input').disabled = true;
  statusEl.textContent = '';
  card.classList.remove('error');
  resultEl.classList.add('hidden');
  card.querySelector('.size-estimate').classList.add('hidden');
  progressWrap.classList.remove('hidden');
  progressBar.style.width = '0%';
  startProgress(progressBar);

  try {
    const res = await fetch('/optimize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tempPath: card.dataset.tempPath,
        originalName: card.dataset.originalName,
        originalSizeBytes: card.dataset.originalSizeBytes,
        newName,
        quality,
        maxWidth,
        maxHeight,
        outputFormat,
        maxSizeKB,
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Optimization failed');

    completeProgress(progressBar);
    await new Promise(r => setTimeout(r, 300));
    progressWrap.classList.add('hidden');

    // Update ext badge — PNG without alpha may have been converted to JPG
    extBadge.textContent = '.' + data.newName.split('.').pop();

    // Store optimized filename for ZIP download
    card.dataset.optimizedName = data.newName;

    // Show result
    const barPct = Math.min(100, (data.newSizeBytes / data.originalSizeBytes) * 100);
    resultEl.innerHTML = `
      <div class="result-sizes">
        <span class="result-before">${formatBytes(data.originalSizeBytes)}</span>
        <span class="result-after">${formatBytes(data.newSizeBytes)}</span>
      </div>
      <div class="size-bar ${data.grew ? 'grew' : ''}"><span style="width:${barPct.toFixed(1)}%"></span></div>
    `;
    resultEl.classList.remove('hidden');

    const savePill = card.querySelector('.save-pill');
    savePill.textContent = data.grew ? `+${Math.abs(data.savedPct)}%` : `−${data.savedPct}%`;
    savePill.classList.toggle('grew', data.grew);
    savePill.classList.remove('hidden');

    downloadBtn.href = data.downloadUrl;
    downloadBtn.download = data.newName;
    downloadBtn.classList.remove('hidden');

    card.classList.add('done');
    card.querySelector('.card-resize-row').classList.add('hidden');
    optimizeBtn.classList.add('hidden');

    totalProcessed++;
    totalSavedBytes += data.savedBytes;
    updateStats();
    refreshToolbar();

    if (fireConfetti) {
      requestAnimationFrame(() => {
        const rect = downloadBtn.getBoundingClientRect();
        confetti({
          particleCount: 90,
          spread: 60,
          origin: {
            x: (rect.left + rect.width / 2) / window.innerWidth,
            y: Math.min((rect.top + rect.height / 2) / window.innerHeight, 0.95),
          },
        });
      });
    }

  } catch (err) {
    progressWrap.classList.add('hidden');
    progressBar.style.width = '0%';
    resultEl.innerHTML = `<span class="error-msg">${err.message}</span>`;
    resultEl.classList.remove('hidden');
    optimizeBtn.disabled = false;
    nameInput.disabled = false;
    card.querySelector('.card-w-input').disabled = false;
    card.querySelector('.card-h-input').disabled = false;
    card.classList.add('error');
  }
}

// ── Optimize All ──────────────────────────────────────────────────────────────
async function optimizeAll() {
  const list = document.getElementById('image-list');
  const allCards = Array.from(list.querySelectorAll('.image-card'));

  // Only process cards that have finished uploading and aren't already done/errored
  const readyCards = allCards.filter(card =>
    card.dataset.tempPath &&
    !card.classList.contains('done') &&
    !card.classList.contains('error') &&
    !card.querySelector('.btn-optimize').disabled
  );

  if (readyCards.length === 0) return;

  await Promise.all(readyCards.map(card => optimizeCard(card, { fireConfetti: false })));

  const anySucceeded = readyCards.some(c => c.classList.contains('done'));
  if (anySucceeded) {
    requestAnimationFrame(() => {
      const zipBtn = document.getElementById('btn-download-zip');
      const rect = zipBtn.getBoundingClientRect();
      confetti({
        particleCount: 90,
        spread: 60,
        origin: {
          x: (rect.left + rect.width / 2) / window.innerWidth,
          y: Math.min((rect.top + rect.height / 2) / window.innerHeight, 0.95),
        },
      });
    });
  }
}

// ── Download All as ZIP ───────────────────────────────────────────────────────
async function downloadAllZip() {
  const files = Array.from(document.querySelectorAll('.image-card.done'))
    .map(card => card.dataset.optimizedName)
    .filter(Boolean);

  if (files.length === 0) return;

  const zipBtn = document.getElementById('btn-download-zip');
  const original = zipBtn.textContent;
  zipBtn.disabled = true;
  zipBtn.textContent = 'Zipping…';

  try {
    const res = await fetch('/zip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'ZIP failed');
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'optimized-images.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    const rect = zipBtn.getBoundingClientRect();
    confetti({
      particleCount: 90,
      spread: 60,
      origin: {
        x: (rect.left + rect.width / 2) / window.innerWidth,
        y: (rect.top + rect.height / 2) / window.innerHeight,
      },
    });
  } catch (err) {
    alert(`ZIP download failed: ${err.message}`);
  } finally {
    zipBtn.disabled = false;
    zipBtn.textContent = original;
  }
}

// ── Add files to the queue ────────────────────────────────────────────────────
function addFiles(files) {
  const list = document.getElementById('image-list');
  const supported = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.pdf']);

  Array.from(files).forEach(file => {
    const ext = (file.name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
    if (!supported.has(ext)) return;

    const localUrl = URL.createObjectURL(file);
    const card = buildCard(file, localUrl);
    list.appendChild(card);
    applyPrefix(); // assign prefix-N immediately if a prefix is already set

    card.querySelector('.btn-optimize').addEventListener('click', () => optimizeCard(card));

    uploadFile(file, card);
    refreshToolbar();
  });
}

// ── Patch notes toggle ────────────────────────────────────────────────────────
document.getElementById('patch-toggle').addEventListener('click', (e) => {
  e.stopPropagation();
  document.getElementById('patch-panel').classList.toggle('open');
});

document.addEventListener('click', (e) => {
  if (!document.getElementById('patch-notes').contains(e.target)) {
    document.getElementById('patch-panel').classList.remove('open');
  }
});

// ── Tools rail ────────────────────────────────────────────────────────────────
// Pin just under the header when the rail fits the window; when it's taller than the
// window, pin by its bottom edge instead so the queue actions never scroll out of view.
const rail = document.querySelector('.rail');
function placeRail() {
  const headerH = document.querySelector('header').offsetHeight;
  const bar = document.getElementById('update-bar');
  bar.style.top = `${headerH}px`;
  const barH = bar.classList.contains('hidden') ? 0 : bar.offsetHeight;
  const top = Math.min(headerH + barH + 22, window.innerHeight - rail.offsetHeight - 16);
  rail.style.setProperty('--rail-top', `${top}px`);
}
window.addEventListener('resize', placeRail);
new ResizeObserver(placeRail).observe(rail);
placeRail();

// ── Update banner ─────────────────────────────────────────────────────────────
// Asks the server whether GitHub has a newer version. Checks on load, then hourly.
// Dismissing hides it until the next version comes out.
const shortVersion = (v) => 'v' + v.split('.').slice(0, 2).join('.');

async function checkForUpdate() {
  try {
    const d = await (await fetch('/update-check')).json();
    document.getElementById('version-badge').textContent = shortVersion(d.current);

    let dismissed = null;
    try { dismissed = localStorage.getItem('dismissedUpdate'); } catch {}

    const bar = document.getElementById('update-bar');
    const show = d.updateAvailable && dismissed !== d.latest;
    if (show) {
      bar.querySelector('.update-version').textContent = `${shortVersion(d.latest)} is out`;
      bar.querySelector('.update-note').textContent = d.note;
      bar.dataset.version = d.latest;
    }
    bar.classList.toggle('hidden', !show);
    placeRail();
  } catch {
    // offline or server restarting: try again next hour
  }
}

document.querySelector('.update-x').addEventListener('click', () => {
  const bar = document.getElementById('update-bar');
  try { localStorage.setItem('dismissedUpdate', bar.dataset.version); } catch {}
  bar.classList.add('hidden');
  placeRail();
});

checkForUpdate();
setInterval(checkForUpdate, 60 * 60 * 1000);

// ── How it works ──────────────────────────────────────────────────────────────
// 'auto' = shown only while the queue is empty; the button switches to 'open' or 'closed'.
document.getElementById('help-toggle').addEventListener('click', () => {
  const tips = document.getElementById('tips');
  const opening = tips.classList.contains('hidden');
  tipsMode = opening ? 'open' : 'closed';
  refreshToolbar();
  if (opening) tips.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});

// ── Drop zone ─────────────────────────────────────────────────────────────────
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');

dropZone.addEventListener('click', (e) => {
  if (e.target.tagName !== 'LABEL') fileInput.click();
});

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', (e) => {
  if (!dropZone.contains(e.relatedTarget)) dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  addFiles(e.dataTransfer.files);
});

fileInput.addEventListener('change', () => {
  addFiles(fileInput.files);
  fileInput.value = '';
});

// ── Toolbar buttons ───────────────────────────────────────────────────────────
document.getElementById('btn-optimize-all').addEventListener('click', optimizeAll);
document.getElementById('btn-download-zip').addEventListener('click', downloadAllZip);
