'use strict';
/* =====================================================================
 * Halftone Mo — a tiny risograph / halftone / duotone poster studio.
 * 100% static: vanilla JS + canvas, no network, no dependencies.
 * ===================================================================== */

// ---------------------------------------------------------------- utils

/** Clamp a number into [min, max]. */
function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

/** Parse "#rgb" or "#rrggbb" into [r, g, b] (0-255). */
function hexToRgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Relative luminance of a hex color, 0..1. Used to pick a blend mode. */
function hexLuminance(hex) {
  const [r, g, b] = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Deterministic PRNG so sample art is identical on every load. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- state

const PREVIEW_LONG = 760;   // preview canvas long edge (px) — keeps UI snappy
const EXPORT_LONG = 3000;   // export canvas long edge (px)
const INK_A_ANGLE = 15;     // fixed screen angle for ink A (degrees)

const state = {
  dotSize: 9,        // halftone cell size, in preview pixels
  angle: 45,         // screen angle for ink B (degrees); ink A fixed at 15°
  inkA: '#ff48b0',   // shadows
  inkB: '#00a9a5',   // highlights
  paper: '#f6f2e9',
  grain: true,
  brightness: 0,     // -100..100
  contrast: 0,       // -100..100
  sampleIndex: 0,
};

// Curated duotone pairs (classic riso combos).
const PRESETS = [
  { name: 'Riso Pop',  a: '#ff48b0', b: '#00a9a5' },
  { name: 'Blue/Red',  a: '#0078bf', b: '#ff665e' },
  { name: 'Gold/Black',a: '#3a2a00', b: '#ffc800' },
  { name: 'Grape/Mint',a: '#6c4d9e', b: '#7fd1b9' },
  { name: 'Navy/Peach',a: '#1f3a93', b: '#ff9e7d' },
  { name: 'Forest/Rose',a:'#1e6b4f', b: '#f2a0c0' },
];

const PAPERS = [
  { name: 'Paper white', color: '#f6f2e9' },
  { name: 'Cream',       color: '#efe0c3' },
  { name: 'Kraft',       color: '#c9a06a' },
  { name: 'Charcoal',    color: '#232023' },
];

// ---------------------------------------------------------------- dom

const $ = id => document.getElementById(id);
const previewCanvas = $('preview');
const stage = $('stage');
const toastEl = $('toast');
let toastTimer = null;

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
}

// ---------------------------------------------------------------- samples
// Three procedural artworks so the app is fun with zero uploads.

function makeSampleCanvases() {
  const S = 880;
  const mk = () => {
    const c = document.createElement('canvas');
    c.width = c.height = S;
    return [c, c.getContext('2d')];
  };
  const out = [];

  // -- 1. "Bloom": glowing orbs on deep plum. Rich tonal range.
  {
    const [c, x] = mk();
    x.fillStyle = '#221626';
    x.fillRect(0, 0, S, S);
    const orbs = [
      [0.30, 0.32, 300, '#ff5c9e'],
      [0.72, 0.60, 380, '#ff9e4d'],
      [0.55, 0.80, 260, '#37c8b4'],
      [0.82, 0.24, 200, '#7a5cff'],
      [0.45, 0.48, 130, '#fff3d6'],
    ];
    for (const [fx, fy, r, col] of orbs) {
      const g = x.createRadialGradient(S * fx, S * fy, 0, S * fx, S * fy, r);
      g.addColorStop(0, col);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g;
      x.beginPath(); x.arc(S * fx, S * fy, r, 0, Math.PI * 2); x.fill();
    }
    // faint ring accents
    x.strokeStyle = 'rgba(255,255,255,0.25)';
    x.lineWidth = 3;
    for (const [fx, fy, r] of [[0.30, 0.32, 180], [0.72, 0.60, 240]]) {
      x.beginPath(); x.arc(S * fx, S * fy, r, 0, Math.PI * 2); x.stroke();
    }
    out.push({ name: 'Bloom', canvas: c });
  }

  // -- 2. "Peaks": sunset mountain ridges.
  {
    const [c, x] = mk();
    const sky = x.createLinearGradient(0, 0, 0, S);
    sky.addColorStop(0, '#2b1b4d');
    sky.addColorStop(0.55, '#c73e6d');
    sky.addColorStop(1, '#ff9e4d');
    x.fillStyle = sky;
    x.fillRect(0, 0, S, S);
    // sun
    x.fillStyle = '#ffe9b8';
    x.beginPath(); x.arc(S * 0.5, S * 0.60, 70, 0, Math.PI * 2); x.fill();
    // ridges, far to near
    const rand = mulberry32(7);
    const layers = [
      { y: 0.55, amp: 90, col: '#5a2d5a' },
      { y: 0.68, amp: 110, col: '#3c2144' },
      { y: 0.82, amp: 90, col: '#241430' },
    ];
    for (const { y, amp, col } of layers) {
      x.fillStyle = col;
      x.beginPath();
      x.moveTo(0, S);
      x.lineTo(0, S * y);
      for (let px = 0; px <= S; px += 44) {
        x.lineTo(px, S * y - rand() * amp);
      }
      x.lineTo(S, S);
      x.closePath();
      x.fill();
    }
    // birds
    x.strokeStyle = 'rgba(30,12,30,0.85)';
    x.lineWidth = 4;
    x.lineCap = 'round';
    const birds = [[0.25, 0.30], [0.33, 0.26], [0.68, 0.34], [0.75, 0.29]];
    for (const [fx, fy] of birds) {
      const bx = S * fx, by = S * fy;
      x.beginPath();
      x.moveTo(bx - 14, by); x.quadraticCurveTo(bx - 4, by - 10, bx, by);
      x.quadraticCurveTo(bx + 4, by - 10, bx + 14, by);
      x.stroke();
    }
    out.push({ name: 'Peaks', canvas: c });
  }

  // -- 3. "Forms": bauhaus-style geometric composition.
  {
    const [c, x] = mk();
    x.fillStyle = '#f2e9d4';
    x.fillRect(0, 0, S, S);
    // big red half-disc
    x.fillStyle = '#d94040';
    x.beginPath(); x.arc(S * 0.32, S * 0.42, 220, Math.PI, 0); x.fill();
    // black ring
    x.strokeStyle = '#1d1a1e';
    x.lineWidth = 26;
    x.beginPath(); x.arc(S * 0.68, S * 0.30, 110, 0, Math.PI * 2); x.stroke();
    // blue bars
    x.fillStyle = '#2b5fa6';
    x.fillRect(S * 0.12, S * 0.66, S * 0.50, 44);
    x.fillRect(S * 0.12, S * 0.74, S * 0.34, 44);
    // yellow triangle
    x.fillStyle = '#e8a820';
    x.beginPath();
    x.moveTo(S * 0.72, S * 0.62); x.lineTo(S * 0.90, S * 0.88); x.lineTo(S * 0.54, S * 0.88);
    x.closePath(); x.fill();
    // dot grid accent
    x.fillStyle = '#1d1a1e';
    for (let gy = 0; gy < 4; gy++) {
      for (let gx = 0; gx < 6; gx++) {
        x.beginPath();
        x.arc(S * 0.62 + gx * 34, S * 0.10 + gy * 30, 5, 0, Math.PI * 2);
        x.fill();
      }
    }
    out.push({ name: 'Forms', canvas: c });
  }

  return out;
}

// ---------------------------------------------------------------- source image

// Full-resolution working copy of the current source (capped for memory).
const srcCanvas = document.createElement('canvas');
const MAX_SRC_LONG = 1600;

function setSourceFromCanvas(c) {
  const scale = Math.min(1, MAX_SRC_LONG / Math.max(c.width, c.height));
  srcCanvas.width = Math.max(1, Math.round(c.width * scale));
  srcCanvas.height = Math.max(1, Math.round(c.height * scale));
  srcCanvas.getContext('2d').drawImage(c, 0, 0, srcCanvas.width, srcCanvas.height);
  scheduleRender();
}

function loadFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    toast('Please choose an image file.');
    return;
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    setSourceFromCanvas(c);
    setActiveThumb(-1);
    toast('Image loaded — make it yours.');
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    toast('Could not read that image.');
  };
  img.src = url;
}

// ---------------------------------------------------------------- render core

// Reusable grain tile (generated once).
let grainTile = null;
function getGrainTile() {
  if (grainTile) return grainTile;
  const s = 128;
  grainTile = document.createElement('canvas');
  grainTile.width = grainTile.height = s;
  const x = grainTile.getContext('2d');
  const img = x.createImageData(s, s);
  const rand = mulberry32(1234);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.floor(rand() * 255);
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  return grainTile;
}

/** Luminance field (0..1) of `source` scaled to W×H, with adjustments. */
function computeLuminance(source, W, H, brightness, contrast) {
  const off = document.createElement('canvas');
  off.width = W; off.height = H;
  const ox = off.getContext('2d', { willReadFrequently: true });
  ox.drawImage(source, 0, 0, W, H);
  const data = ox.getImageData(0, 0, W, H).data;
  // standard contrast curve; brightness as a plain offset
  const c = contrast * 2.55;
  const cf = (259 * (c + 255)) / (255 * (259 - c));
  const bo = brightness * 1.5;
  const lum = new Float32Array(W * H);
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
    let L = 0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2];
    L = (L - 128) * cf + 128 + bo;
    lum[i] = clamp(L / 255, 0, 1);
  }
  return lum;
}

/**
 * Draw one halftone screen: a rotated grid of dots whose radius follows
 * the tonal value. `mode` 'shadow' → dots grow in dark areas (ink A),
 * 'highlight' → dots grow in bright areas (ink B).
 */
function drawScreen(ctx, lum, W, H, { angleDeg, color, cell, mode, blend, dotScale = 1 }) {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const maxR = cell * 0.75 * dotScale; // slight overlap → solid blacks stay solid
  const diag = Math.sqrt(W * W + H * H);

  ctx.save();
  ctx.globalCompositeOperation = blend;
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let gy = -diag / 2; gy < diag / 2; gy += cell) {
    for (let gx = -diag / 2; gx < diag / 2; gx += cell) {
      // rotate grid point back into canvas space
      const cx = W / 2 + gx * cos - gy * sin;
      const cy = H / 2 + gx * sin + gy * cos;
      if (cx < -cell || cx > W + cell || cy < -cell || cy > H + cell) continue;
      const px = clamp(Math.round(cx), 0, W - 1);
      const py = clamp(Math.round(cy), 0, H - 1);
      const L = lum[py * W + px];
      let t = mode === 'shadow' ? 1 - L : L;
      t = Math.pow(t, 1.15); // gentle gamma → nicer dot ramp
      if (t <= 0.02) continue;
      const r = maxR * t;
      ctx.moveTo(cx + r, cy);
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
    }
  }
  ctx.fill();
  ctx.restore();
}

function applyGrain(ctx, W, H) {
  // monochrome noise, tiled
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = 0.10;
  ctx.fillStyle = ctx.createPattern(getGrainTile(), 'repeat');
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  // soft vignette for a printed feel
  const g = ctx.createRadialGradient(
    W / 2, H / 2, Math.min(W, H) * 0.35,
    W / 2, H / 2, Math.max(W, H) * 0.75
  );
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.16)');
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

/**
 * Full pipeline: paper → ink A screen → ink B screen → grain.
 * `target` is sized by the caller; dotSize is in target pixels.
 */
function renderHalftone(target, source, o) {
  const W = target.width, H = target.height;
  if (!W || !H || !source.width) return;
  const ctx = target.getContext('2d');

  const lum = computeLuminance(source, W, H, o.brightness, o.contrast);

  // paper base
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = o.paper;
  ctx.fillRect(0, 0, W, H);

  // On dark paper, 'screen' keeps inks visible; on light paper,
  // 'multiply' gives the authentic overprinted-ink look.
  // On dark paper the highlight screen is softened so the paper itself
  // stays visible in bright areas instead of flooding with ink.
  const darkPaper = hexLuminance(o.paper) < 0.25;
  const blend = darkPaper ? 'screen' : 'multiply';

  drawScreen(ctx, lum, W, H, {
    angleDeg: INK_A_ANGLE, color: o.inkA, cell: o.dotSize,
    mode: 'shadow', blend,
  });
  drawScreen(ctx, lum, W, H, {
    angleDeg: o.angle, color: o.inkB, cell: o.dotSize,
    mode: 'highlight', blend, dotScale: darkPaper ? 0.45 : 1,
  });

  if (o.grain) applyGrain(ctx, W, H);
}

// ---------------------------------------------------------------- preview

let previewLong = PREVIEW_LONG; // actual long edge of preview canvas
let renderQueued = false;

function renderPreview() {
  if (!srcCanvas.width) return;
  const scale = PREVIEW_LONG / Math.max(srcCanvas.width, srcCanvas.height);
  const W = Math.max(1, Math.round(srcCanvas.width * scale));
  const H = Math.max(1, Math.round(srcCanvas.height * scale));
  previewLong = Math.max(W, H);
  if (previewCanvas.width !== W || previewCanvas.height !== H) {
    previewCanvas.width = W;
    previewCanvas.height = H;
  }
  renderHalftone(previewCanvas, srcCanvas, {
    dotSize: state.dotSize,
    angle: state.angle,
    inkA: state.inkA,
    inkB: state.inkB,
    paper: state.paper,
    grain: state.grain,
    brightness: state.brightness,
    contrast: state.contrast,
  });
}

function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    try { renderPreview(); }
    catch (err) { console.error(err); toast('Render failed — try a smaller image.'); }
  });
}

// ---------------------------------------------------------------- export

/**
 * Render at high resolution and return the canvas (no download).
 * Exported dot density matches the preview.
 */
function renderExport(longEdge) {
  const scale = longEdge / Math.max(srcCanvas.width, srcCanvas.height);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(srcCanvas.width * scale));
  c.height = Math.max(1, Math.round(srcCanvas.height * scale));
  const dotScale = Math.max(c.width, c.height) / previewLong;
  renderHalftone(c, srcCanvas, {
    dotSize: Math.max(1, state.dotSize * dotScale),
    angle: state.angle,
    inkA: state.inkA,
    inkB: state.inkB,
    paper: state.paper,
    grain: state.grain,
    brightness: state.brightness,
    contrast: state.contrast,
  });
  return c;
}

async function exportPNG() {
  const btn = $('exportBtn');
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = 'Rendering…';
  try {
    // let the UI breathe before the heavy render
    await new Promise(r => setTimeout(r, 40));
    const c = renderExport(EXPORT_LONG);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    if (!blob) throw new Error('encoding failed');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'halftone-mo.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast(`Exported PNG — ${c.width}×${c.height}px.`);
  } catch (err) {
    console.error(err);
    toast('Export failed — try a smaller dot size.');
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

// ---------------------------------------------------------------- ui wiring

let samples = [];

function buildThumbs() {
  const wrap = $('thumbs');
  wrap.innerHTML = '';
  samples.forEach((s, i) => {
    const b = document.createElement('button');
    b.className = 'thumb' + (i === state.sampleIndex ? ' active' : '');
    b.title = s.name;
    b.setAttribute('aria-label', 'Use sample: ' + s.name);
    const t = document.createElement('canvas');
    t.width = t.height = 120;
    t.getContext('2d').drawImage(s.canvas, 0, 0, 120, 120);
    const img = document.createElement('img');
    img.src = t.toDataURL('image/png');
    img.alt = s.name;
    b.appendChild(img);
    b.addEventListener('click', () => selectSample(i));
    wrap.appendChild(b);
  });
}

function setActiveThumb(i) {
  [...$('thumbs').children].forEach((el, k) =>
    el.classList.toggle('active', k === i));
}

function selectSample(i) {
  state.sampleIndex = i;
  setSourceFromCanvas(samples[i].canvas);
  setActiveThumb(i);
}

function buildPresets() {
  const wrap = $('presets');
  wrap.innerHTML = '';
  PRESETS.forEach((p, i) => {
    const b = document.createElement('button');
    b.className = 'preset';
    b.title = `${p.name}: ${p.a} + ${p.b}`;
    b.innerHTML =
      `<span class="sw"><i style="background:${p.a}"></i><i style="background:${p.b}"></i></span>` +
      `<span>${p.name}</span>`;
    b.addEventListener('click', () => {
      state.inkA = p.a; state.inkB = p.b;
      $('inkA').value = p.a; $('inkB').value = p.b;
      [...wrap.children].forEach((el, k) => el.classList.toggle('active', k === i));
      scheduleRender();
    });
    wrap.appendChild(b);
  });
}

function buildPapers() {
  const wrap = $('papers');
  wrap.innerHTML = '';
  PAPERS.forEach((p, i) => {
    const b = document.createElement('button');
    b.className = 'paper' + (i === 0 ? ' active' : '');
    b.style.background = p.color;
    b.title = p.name;
    b.setAttribute('aria-label', 'Paper: ' + p.name);
    b.addEventListener('click', () => {
      state.paper = p.color;
      [...wrap.children].forEach((el, k) => el.classList.toggle('active', k === i));
      scheduleRender();
    });
    wrap.appendChild(b);
  });
}

function bindRange(id, valId, fmt, set) {
  const el = $(id);
  const val = $(valId);
  const update = () => {
    set(parseFloat(el.value));
    val.textContent = fmt(parseFloat(el.value));
    scheduleRender();
  };
  el.addEventListener('input', update);
  // sync label once at startup
  val.textContent = fmt(parseFloat(el.value));
}

function wireUI() {
  bindRange('dotSize', 'dotVal', v => `${v}px`, v => state.dotSize = v);
  bindRange('angle', 'angleVal', v => `${v}°`, v => state.angle = v);
  bindRange('brightness', 'brightVal', v => `${v}`, v => state.brightness = v);
  bindRange('contrast', 'contrastVal', v => `${v}`, v => state.contrast = v);

  $('inkA').addEventListener('input', e => { state.inkA = e.target.value; scheduleRender(); });
  $('inkB').addEventListener('input', e => { state.inkB = e.target.value; scheduleRender(); });
  $('swapBtn').addEventListener('click', () => {
    [state.inkA, state.inkB] = [state.inkB, state.inkA];
    $('inkA').value = state.inkA;
    $('inkB').value = state.inkB;
    scheduleRender();
    toast('Inks swapped.');
  });
  $('grain').addEventListener('change', e => { state.grain = e.target.checked; scheduleRender(); });

  $('uploadBtn').addEventListener('click', () => $('fileInput').click());
  $('fileInput').addEventListener('change', e => {
    if (e.target.files[0]) loadFile(e.target.files[0]);
    e.target.value = '';
  });

  // drag & drop anywhere on the page
  let dragDepth = 0;
  window.addEventListener('dragenter', e => { e.preventDefault(); dragDepth++; stage.classList.add('dragover'); });
  window.addEventListener('dragleave', e => { e.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; stage.classList.remove('dragover'); } });
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => {
    e.preventDefault();
    dragDepth = 0;
    stage.classList.remove('dragover');
    if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
  });

  $('exportBtn').addEventListener('click', exportPNG);
}

// ---------------------------------------------------------------- url params
// Handy for testing and for shareable settings, e.g.
// ?sample=1&dots=14&angle=60&inkA=%23ff0000&inkB=%2300ffcc&paper=3&grain=0

function applyUrlParams() {
  const q = new URLSearchParams(location.search);
  const setRange = (id, key) => {
    if (!q.has(key)) return;
    const v = parseFloat(q.get(key));
    if (Number.isFinite(v)) {
      const el = $(id);
      el.value = clamp(v, parseFloat(el.min), parseFloat(el.max));
      el.dispatchEvent(new Event('input'));
    }
  };
  setRange('dotSize', 'dots');
  setRange('angle', 'angle');
  setRange('brightness', 'bright');
  setRange('contrast', 'contrast');
  if (q.has('inkA') && /^#[0-9a-f]{6}$/i.test(q.get('inkA'))) {
    state.inkA = q.get('inkA'); $('inkA').value = state.inkA;
  }
  if (q.has('inkB') && /^#[0-9a-f]{6}$/i.test(q.get('inkB'))) {
    state.inkB = q.get('inkB'); $('inkB').value = state.inkB;
  }
  if (q.has('paper')) {
    const i = clamp(parseInt(q.get('paper'), 10) || 0, 0, PAPERS.length - 1);
    state.paper = PAPERS[i].color;
    [...$('papers').children].forEach((el, k) => el.classList.toggle('active', k === i));
  }
  if (q.get('grain') === '0') { state.grain = false; $('grain').checked = false; }
  if (q.has('sample')) {
    const i = clamp(parseInt(q.get('sample'), 10) || 0, 0, samples.length - 1);
    selectSample(i);
  }
}

// ---------------------------------------------------------------- self test
// ?selftest=1 → renders everything headlessly, reports into document.title.

function canvasIsNonBlank(c) {
  const x = c.getContext('2d', { willReadFrequently: true });
  const d = x.getImageData(0, 0, c.width, c.height).data;
  let sum = 0, sumSq = 0, n = 0;
  for (let i = 0; i < d.length; i += 401 * 4) {
    const v = (d[i] + d[i + 1] + d[i + 2]) / 3;
    sum += v; sumSq += v * v; n++;
  }
  const mean = sum / n;
  const variance = sumSq / n - mean * mean;
  return variance > 25; // flat single-color fills stay well below this
}

async function selfTest() {
  const results = [];
  const ok = (name, cond) => results.push([name, !!cond]);
  try {
    renderPreview();
    ok('preview-render', canvasIsNonBlank(previewCanvas));
    for (let i = 0; i < samples.length; i++) {
      selectSample(i);
      renderPreview();
      ok('sample-' + i, canvasIsNonBlank(previewCanvas));
    }
    selectSample(0);
    renderPreview();
    const exp = renderExport(480);
    ok('export-render', exp.width > 0 && canvasIsNonBlank(exp));
    const blob = await new Promise(r => exp.toBlob(r, 'image/png'));
    ok('export-blob', !!blob && blob.size > 2000);
    ok('export-size', exp.width === 480 || exp.height === 480);
  } catch (e) {
    results.push(['exception: ' + e.message, false]);
  }
  const passed = results.filter(r => r[1]).length;
  const allOk = passed === results.length;
  document.title = `SELFTEST ${passed}/${results.length} ${allOk ? 'PASS' : 'FAIL'}`;
  const el = $('selftest');
  el.hidden = false;
  el.textContent = results.map(r => `${r[1] ? 'ok' : 'FAIL'}  ${r[0]}`).join('\n');
}

// ---------------------------------------------------------------- init

function init() {
  samples = makeSampleCanvases();
  buildThumbs();
  buildPresets();
  buildPapers();
  wireUI();
  // default artwork so the app opens with something beautiful
  setSourceFromCanvas(samples[0].canvas);
  setActiveThumb(0);
  applyUrlParams();
  scheduleRender();
  if (new URLSearchParams(location.search).get('selftest') === '1') {
    // wait a tick for the first preview, then run the suite
    setTimeout(selfTest, 600);
  }
}

document.addEventListener('DOMContentLoaded', init);
