'use strict';

// ── Globals ───────────────────────────────────────────────────────────────────
let totalProcessed = 0;
let totalSavedBytes = 0;
let cardIdCounter = 0;
let dragSrc = null;

// ── Helpers ───────────────────────────────────────────────────────────────────
function toKebabCase(str) {
  return str
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s\-_]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function updateStats() {
  document.getElementById('stat-count').textContent = totalProcessed;
  document.getElementById('stat-saved').textContent = formatBytes(Math.max(0, totalSavedBytes));
}

// ── Size estimation ───────────────────────────────────────────────────────────
// Rough formula: accounts for format conversion, quality, and resize.
// Not perfectly accurate — designed for ballpark feedback while dragging.
function estimateOutputSize(originalSize, ext, natW, natH, settings) {
  const { quality, maxWidth, maxHeight, outputFormat } = settings;

  // Pixel-area reduction from resize (only when image would actually shrink)
  let resizeFactor = 1;
  if ((maxWidth || maxHeight) && natW > 0 && natH > 0) {
    const scale = Math.min(
      1,
      maxWidth  ? maxWidth  / natW : Infinity,
      maxHeight ? maxHeight / natH : Infinity,
    );
    resizeFactor = scale * scale;
  }

  // q = quality relative to our default of 80
  const q = quality / 80;
  const isPng = ext === '.png';

  let formatFactor;
  if (outputFormat === 'png') {
    // Lossless — quality slider has no meaningful effect on PNG output
    formatFactor = isPng ? 0.92 : 3.5; // JPG→PNG bloats; PNG→PNG minimal savings
  } else if (outputFormat === 'webp') {
    formatFactor = isPng ? 0.20 * q : 0.55 * q;
  } else {
    // 'jpg' or 'auto' (auto converts PNG→JPG for opaque images)
    formatFactor = isPng ? 0.28 * q : Math.min(0.98, 0.9 * q);
  }

  return Math.max(512, Math.round(originalSize * formatFactor * resizeFactor));
}

function updateEstimate(card) {
  const el = card.querySelector('.size-estimate');
  if (!el) return;

  // Hide once we have actual results
  if (card.classList.contains('done')) {
    el.classList.add('hidden');
    return;
  }

  const originalSize = parseInt(card.dataset.originalSizeBytes, 10);
  if (!originalSize) { el.classList.add('hidden'); return; }

  const natW = parseInt(card.dataset.natW, 10) || 0;
  const natH = parseInt(card.dataset.natH, 10) || 0;
  const ext  = card.dataset.ext || '.jpg';

  const settings = getCardSettings(card);
  const estimated = estimateOutputSize(originalSize, ext, natW, natH, settings);
  const pct = (originalSize - estimated) / originalSize * 100;
  const sign = pct >= 0 ? '-' : '+';

  let dimsPart = '';
  if ((settings.maxWidth || settings.maxHeight) && natW > 0 && natH > 0) {
    const scale = Math.min(
      1,
      settings.maxWidth  ? settings.maxWidth  / natW : Infinity,
      settings.maxHeight ? settings.maxHeight / natH : Infinity,
    );
    if (scale < 1) {
      dimsPart = ` · ${Math.round(natW * scale)} × ${Math.round(natH * scale)} px`;
    }
  }

  const badgeClass = pct >= 30 ? 'est-great' : pct >= 10 ? 'est-ok' : pct < 0 ? 'est-grew' : '';
  const pctBadge = badgeClass
    ? `<span class="${badgeClass}">${sign}${Math.abs(pct).toFixed(0)}%</span>`
    : `${sign}${Math.abs(pct).toFixed(0)}%`;

  el.innerHTML = `<span class="meta-label">Estimated:</span> ~${formatBytes(estimated)} (${pctBadge})${dimsPart}`;
  el.className = 'size-estimate';
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
  return { quality, maxWidth, maxHeight, outputFormat, prefix };
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
  });
}

document.getElementById('prefix-input').addEventListener('input', applyPrefix);
document.getElementById('start-number-input').addEventListener('input', applyPrefix);

// Settings panel collapse
const settingsToggle = document.getElementById('settings-toggle');
const settingsBody = document.getElementById('settings-body');
const chevron = settingsToggle.querySelector('.chevron');

settingsToggle.addEventListener('click', () => {
  const opening = !settingsBody.classList.contains('open');
  settingsBody.classList.toggle('open', opening);
  chevron.classList.toggle('rotated', opening);
  settingsToggle.setAttribute('aria-expanded', opening);
  if (opening) document.getElementById('settings-panel').classList.remove('hint');
});

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

  const li = document.createElement('li');
  li.className = 'image-card';
  li.id = `card-${id}`;

  li.innerHTML = `
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
    <div class="card-thumb">
      <img src="${localUrl}" alt="">
    </div>
    <div class="card-body">
      <div class="card-name-row">
        <input type="text" class="name-input" value="${baseName}" spellcheck="false">
        <span class="ext-badge">${ext}</span>
        <button class="btn-remove" title="Remove">&times;</button>
      </div>
      <div class="card-meta">
        <span class="orig-size"><span class="meta-label">Original:</span> ${formatBytes(file.size)}<span class="orig-dims"></span></span>
        <span class="upload-status">Uploading…</span>
      </div>
      <div class="size-estimate hidden"></div>
      <div class="card-resize-row">
        <span class="resize-label">Resize:</span>
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
    const activePrefix = toKebabCase(document.getElementById('prefix-input').value);
    if (!activePrefix) {
      li.dataset.baseName = kebab;
    }
  });

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
async function optimizeCard(card) {
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

  const { quality, maxWidth, maxHeight, outputFormat } = getCardSettings(card);
  const newName = toKebabCase(nameInput.value) ||
    toKebabCase(card.dataset.originalName || 'image');
  nameInput.value = newName;

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
        newName,
        quality,
        maxWidth,
        maxHeight,
        outputFormat,
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
    resultEl.innerHTML = `
      <span class="result-before">${data.originalSize}</span>
      <span class="result-arrow">→</span>
      <span class="result-after">${data.newSize}</span>
      <span class="result-badge ${data.grew ? 'grew' : 'saved'}">
        ${data.grew ? `+${Math.abs(data.savedPct)}%` : `–${data.savedPct}%`}
      </span>
    `;
    resultEl.classList.remove('hidden');

    downloadBtn.href = data.downloadUrl;
    downloadBtn.download = data.newName;
    downloadBtn.classList.remove('hidden');

    card.classList.add('done');
    card.querySelector('.card-resize-row').classList.add('hidden');

    totalProcessed++;
    totalSavedBytes += data.savedBytes;
    updateStats();
    refreshToolbar();

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

  await Promise.all(readyCards.map(card => optimizeCard(card)));
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
  const supported = new Set(['.jpg', '.jpeg', '.png']);

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

  // Hint the settings bar if it hasn't been opened yet
  if (settingsToggle.getAttribute('aria-expanded') === 'false') {
    document.getElementById('settings-panel').classList.add('hint');
  }
}

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
