/**
 * Stardew Valley Map Editor - Frontend Logic
 * Vanilla JS + HTML5 Canvas, no framework, no server.
 */

'use strict';

// ===========================================================================
// State
// ===========================================================================

const state = {
  map: null,          // current map object
  filePath: null,     // last saved path (only in Node.js context)
  dirty: false,       // unsaved changes
  activeLayer: 0,     // index of selected layer
  activeTsIndex: 0,   // index of selected tilesheet
  selTile: { x: 0, y: 0 }, // selected tile coords in tilesheet
  selTileEnd: null,   // for multi-tile selection { x, y }
  tool: 'select',     // select | paint | erase | fill | eyedrop | tiledata
  zoom: 1.0,
  pan: { x: 0, y: 0 },
  showGrid: true,
  showCollision: false,  // collision overlay toggle
  showTileData: false,   // TileData overlay toggle
  animPreview: false,    // animation preview toggle
  animTime: 0,           // elapsed ms since animation preview started (for per-tile frame intervals)
  animTimer: null,       // requestAnimationFrame handle
  season: 'spring',      // current season: spring | summer | fall | winter
  hoverTile: null,
  inspectedTileCoord: null, // { x, y } of last clicked tile (select tool)
  isDragging: false,
  dragStart: null,
  isPainting: false,
  undoStack: [],
  redoStack: [],
  tileImages: {},     // id -> HTMLImageElement
  tileMissing: {},    // id -> true if image failed/not loaded (for error display)
  tsCache: {},        // id -> tilesheet metadata (cache for drawTile lookups)
};

// ===========================================================================
// Node.js / Browser shim
// ===========================================================================

const IS_NODE = typeof process !== 'undefined' && process.versions && process.versions.node;

// Default animation frame interval (ms) used when a tile's frameInterval is 0 or missing
const DEFAULT_FRAME_INTERVAL_MS = 150;

let tbinAddon = null;
if (IS_NODE) {
  const path = require('path');
  const ROOT = path.join(__dirname);
  const ADDON = path.join(ROOT, 'build', 'Release', 'tbin_addon.node');
  const FS    = path.join(ROOT, 'src', 'tbin-js-fallback.js');
  try {
    tbinAddon = require(ADDON);
  } catch {
    try { tbinAddon = require(FS); } catch { /* browser mode */ }
  }
}

// ===========================================================================
// Asset Manager (auto-loads tilesheets from assets/ via AssetLibrary)
// ===========================================================================

let assetManager = null;

(async function initAssetManager() {
  if (typeof AssetLibrary === 'undefined' || typeof AssetManager === 'undefined') return;
  const library = new AssetLibrary();
  assetManager  = new AssetManager(library, state);
  await assetManager.init();
})();

// ===========================================================================
// Component instances (TileDataEditor, AnimationEditor, TouchHandler)
// ===========================================================================

let tileDataEditor = null;
let animationEditor = null;
let touchHandler = null;

// ===========================================================================
// DOM references
// ===========================================================================

const $ = id => document.getElementById(id);
const mapCanvas    = $('map-canvas');
const tsCanvas     = $('tileset-canvas');
const tsOverlay    = $('tileset-preview-overlay');
const canvasArea   = $('canvas-area');
const layerList    = $('layer-list');
const propsDiv     = $('props-list');
const inspectorDiv = $('tile-inspector');
const statusMsg    = $('status-msg');
const statusCursor = $('status-cursor');
const statusTile   = $('status-tile');
const statusTool   = $('status-tool');
const zoomDisplay  = $('zoom-display');
const tsSelect     = $('tileset-select');
const infoId       = $('info-id');
const infoSize     = $('info-size');
const infoLayers   = $('info-layers');
const infoTsheets  = $('info-tsheets');

const mCtx = mapCanvas.getContext('2d');
const tCtx = tsCanvas.getContext('2d');

// ===========================================================================
// Map model helpers
// ===========================================================================

/**
 * Calculate tiles per row for a tilesheet, accounting for margin/spacing.
 * margin:  pixels around the entire sheet edge (applied once on each side)
 * spacing: pixels between individual tiles
 */
function getTilesPerRow(ts) {
  const margin  = ts.margin  || 0;
  const spacing = ts.spacing || 0;
  if (margin === 0 && spacing === 0) {
    return Math.max(1, Math.floor(ts.sheetWidth / ts.tileWidth));
  }
  return Math.max(1, Math.floor((ts.sheetWidth - 2 * margin + spacing) / (ts.tileWidth + spacing)));
}

/** Pixel x-coordinate of the left edge of tile at column tileX. */
function getTilePixelX(ts, tileX) {
  const margin  = ts.margin  || 0;
  const spacing = ts.spacing || 0;
  return margin + tileX * (ts.tileWidth + spacing);
}

/** Pixel y-coordinate of the top edge of tile at row tileY. */
function getTilePixelY(ts, tileY) {
  const margin  = ts.margin  || 0;
  const spacing = ts.spacing || 0;
  return margin + tileY * (ts.tileHeight + spacing);
}

function createEmptyMap(id = 'NewMap', desc = '', w = 30, h = 20, tileW = 16, tileH = 16) {
  return {
    id,
    desc,
    props: {},
    tilesheets: [],
    layers: [
      createLayer('Back', w, h, tileW, tileH),
      createLayer('Buildings', w, h, tileW, tileH),
      createLayer('Front', w, h, tileW, tileH),
    ],
  };
}

function createLayer(id, w, h, tileW = 16, tileH = 16) {
  return {
    id,
    desc: '',
    visible: true,
    layerWidth:  w,
    layerHeight: h,
    tileWidth:   tileW,
    tileHeight:  tileH,
    props: {},
    tiles: new Array(w * h).fill(null).map(() => ({ isNull: true })),
  };
}

function getActiveLayer() {
  if (!state.map) return null;
  return state.map.layers[state.activeLayer] || null;
}

function getActiveTilesheet() {
  if (!state.map || !state.map.tilesheets.length) return null;
  return state.map.tilesheets[state.activeTsIndex] || null;
}

// ===========================================================================
// Undo / Redo
// ===========================================================================

function pushUndo() {
  state.undoStack.push(JSON.stringify(state.map));
  if (state.undoStack.length > 100) state.undoStack.shift();
  state.redoStack = [];
  state.dirty = true;
}

function undo() {
  if (!state.undoStack.length) return;
  state.redoStack.push(JSON.stringify(state.map));
  state.map = JSON.parse(state.undoStack.pop());
  afterMapChange();
}

function redo() {
  if (!state.redoStack.length) return;
  state.undoStack.push(JSON.stringify(state.map));
  state.map = JSON.parse(state.redoStack.pop());
  afterMapChange();
}

// ===========================================================================
// Rendering
// ===========================================================================

function resizeCanvas() {
  const rect = canvasArea.getBoundingClientRect();
  mapCanvas.width  = rect.width;
  mapCanvas.height = rect.height;
  renderMap();
}

function renderMap() {
  const ctx = mCtx;
  const { width: W, height: H } = mapCanvas;
  ctx.clearRect(0, 0, W, H);

  if (!state.map) {
    ctx.fillStyle = '#0a0a18';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#2a4080';
    ctx.font = '14px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('Open a .tbin file or create a new map', W / 2, H / 2);
    return;
  }

  ctx.save();
  ctx.translate(state.pan.x, state.pan.y);
  ctx.scale(state.zoom, state.zoom);

  const map = state.map;
  // Draw each visible layer
  for (let li = 0; li < map.layers.length; li++) {
    const layer = map.layers[li];
    if (!layer.visible) continue;
    renderLayer(ctx, layer);
  }

  // Grid
  if (state.showGrid) {
    const layer = getActiveLayer() || (map.layers[0] || null);
    if (layer) {
      const tw = layer.tileWidth;
      const th = layer.tileHeight;
      const lw = layer.layerWidth;
      const lh = layer.layerHeight;
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1 / state.zoom;
      for (let gx = 0; gx <= lw; gx++) {
        ctx.beginPath();
        ctx.moveTo(gx * tw, 0);
        ctx.lineTo(gx * tw, lh * th);
        ctx.stroke();
      }
      for (let gy = 0; gy <= lh; gy++) {
        ctx.beginPath();
        ctx.moveTo(0, gy * th);
        ctx.lineTo(lw * tw, gy * th);
        ctx.stroke();
      }
    }
  }

  // Hover highlight
  if (state.hoverTile) {
    const layer = getActiveLayer();
    if (layer) {
      ctx.fillStyle = 'rgba(255,200,0,0.18)';
      ctx.fillRect(
        state.hoverTile.x * layer.tileWidth,
        state.hoverTile.y * layer.tileHeight,
        layer.tileWidth, layer.tileHeight
      );
    }
  }

  // Collision overlay
  if (state.showCollision) {
    for (let li = 0; li < map.layers.length; li++) {
      const layer = map.layers[li];
      if (!layer.visible) continue;
      renderCollisionOverlay(ctx, layer);
    }
  }

  // TileData overlay (shows tile.props as coloured rectangles with labels)
  if (state.showTileData && tileDataEditor) {
    for (let li = 0; li < map.layers.length; li++) {
      const layer = map.layers[li];
      if (!layer.visible) continue;
      tileDataEditor.renderOverlay(ctx, layer);
    }
  }

  // Selected tile highlight (select tool)
  if (state.inspectedTileCoord) {
    const layer = getActiveLayer();
    if (layer) {
      ctx.strokeStyle = 'rgba(255,255,0,0.9)';
      ctx.lineWidth = 2 / state.zoom;
      ctx.strokeRect(
        state.inspectedTileCoord.x * layer.tileWidth + 1 / state.zoom,
        state.inspectedTileCoord.y * layer.tileHeight + 1 / state.zoom,
        layer.tileWidth  - 2 / state.zoom,
        layer.tileHeight - 2 / state.zoom
      );
    }
  }

  ctx.restore();
}

function renderLayer(ctx, layer) {
  const tw = layer.tileWidth;
  const th = layer.tileHeight;
  for (let ty = 0; ty < layer.layerHeight; ty++) {
    for (let tx = 0; tx < layer.layerWidth; tx++) {
      const tile = layer.tiles[ty * layer.layerWidth + tx];
      if (!tile || tile.isNull) continue;
      drawTile(tile, tx * tw, ty * th, tw, th, ctx);
    }
  }
}

// --- Collision overlay ----------------------------------------------------
// Reads tile properties and draws colored overlays (checked in priority order):
//   1. WaterTile:true -> blue
//   2. NPCBarrier:true -> red (NPC barrier)
//   3. Passable:false -> red (solid)
//   4. Passable:true  -> green (walkable)
//   5. NoRender:true  -> semi-transparent gray
//   6. Buildings/Front layer tiles (fallback) -> red

function renderCollisionOverlay(ctx, layer) {
  const tw = layer.tileWidth;
  const th = layer.tileHeight;
  for (let ty = 0; ty < layer.layerHeight; ty++) {
    for (let tx = 0; tx < layer.layerWidth; tx++) {
      const tile = layer.tiles[ty * layer.layerWidth + tx];
      if (!tile || tile.isNull) continue;
      const props = tile.props || {};
      let color = null;
      if (props['WaterTile'] === true || props['WaterTile'] === 'T') {
        color = 'rgba(30,120,255,0.35)';
      } else if (props['NPCBarrier'] === true || props['NPCBarrier'] === 'T') {
        color = 'rgba(220,40,40,0.35)';
      } else if (props['Passable'] === false || props['Passable'] === 'F') {
        color = 'rgba(220,40,40,0.35)';
      } else if (props['Passable'] === true || props['Passable'] === 'T') {
        color = 'rgba(40,200,40,0.30)';
      } else if (props['NoRender'] === true || props['NoRender'] === 'T') {
        color = 'rgba(120,120,120,0.35)';
      } else if (layer.id === 'Buildings' || layer.id === 'Front') {
        // non-null tiles on Buildings/Front are generally solid
        color = 'rgba(220,40,40,0.28)';
      }
      if (color) {
        ctx.fillStyle = color;
        ctx.fillRect(tx * tw, ty * th, tw, th);
      }
    }
  }
}

function drawTile(tile, dx, dy, dw, dh, ctx) {
  if (!tile || tile.isNull) return null;

  let tsId, tileIdx;
  if (tile.isAnimated && tile.frames && tile.frames.length > 0) {
    // Use elapsed time + per-tile frameInterval for smooth per-tile animation
    let frameIdx = 0;
    if (state.animPreview) {
      const interval = (tile.frameInterval > 0) ? tile.frameInterval : DEFAULT_FRAME_INTERVAL_MS;
      frameIdx = Math.floor(state.animTime / interval) % tile.frames.length;
    }
    // Clamp frameIdx within valid range for safety
    frameIdx = Math.max(0, Math.min(frameIdx, tile.frames.length - 1));
    const frame = tile.frames[frameIdx];
    if (!frame) return null;
    tsId    = frame.tilesheet;
    tileIdx = frame.tileIndex;
  } else {
    tsId    = tile.staticTilesheet;
    tileIdx = tile.staticIndex;
  }

  if (!tsId || tileIdx == null || tileIdx < 0) return null;

  const img = state.tileImages[tsId];
  if (!img || !img.complete) {
    // Missing tileset image: draw a red-X placeholder
    ctx.fillStyle = 'rgba(60,60,70,0.7)';
    ctx.fillRect(dx, dy, dw, dh);
    const s = Math.min(dw, dh) * 0.4;
    ctx.strokeStyle = '#e94560';
    ctx.lineWidth = Math.max(1, s * 0.15);
    ctx.beginPath();
    ctx.moveTo(dx + dw / 2 - s, dy + dh / 2 - s);
    ctx.lineTo(dx + dw / 2 + s, dy + dh / 2 + s);
    ctx.moveTo(dx + dw / 2 + s, dy + dh / 2 - s);
    ctx.lineTo(dx + dw / 2 - s, dy + dh / 2 + s);
    ctx.stroke();
    return null;
  }

  // Find tilesheet metadata (cached for performance)
  let ts = state.tsCache[tsId];
  if (!ts) {
    ts = state.map.tilesheets.find(t => t.id === tsId);
    if (!ts) return null;
    state.tsCache[tsId] = ts;
  }

  const tilesPerRow = getTilesPerRow(ts);
  const sx = getTilePixelX(ts, tileIdx % tilesPerRow);
  const sy = getTilePixelY(ts, Math.floor(tileIdx / tilesPerRow));

  ctx.drawImage(img, sx, sy, ts.tileWidth, ts.tileHeight, dx, dy, dw, dh);
  return true;
}

// --- Tilesheet canvas -----------------------------------------------------

function renderTileset() {
  const ts = getActiveTilesheet();
  // Remove any previous missing-image notice
  const existingNotice = document.getElementById('ts-missing-notice');
  if (existingNotice) existingNotice.remove();

  if (!ts) {
    tCtx.clearRect(0, 0, tsCanvas.width, tsCanvas.height);
    return;
  }
  const img = state.tileImages[ts.id];
  if (!img || !img.complete) {
    tsCanvas.width  = 256;
    tsCanvas.height = 64;
    tCtx.fillStyle = '#0a0a18';
    tCtx.fillRect(0, 0, 256, 64);
    // Draw red X
    tCtx.strokeStyle = '#e94560';
    tCtx.lineWidth = 3;
    tCtx.beginPath();
    tCtx.moveTo(20, 10); tCtx.lineTo(50, 50);
    tCtx.moveTo(50, 10); tCtx.lineTo(20, 50);
    tCtx.stroke();
    tCtx.fillStyle = '#e94560';
    tCtx.font = '12px system-ui';
    tCtx.fillText('No image - click [Img] to load', 60, 36);

    // Show a notice below the canvas area
    const wrap = document.getElementById('tileset-canvas-wrap');
    const notice = document.createElement('div');
    notice.className = 'ts-missing-notice';
    notice.id = 'ts-missing-notice';
    notice.innerHTML = '[!] <strong>' + ts.id + '</strong>: Missing image'
      + (ts.imagePath ? ' (<code>' + ts.imagePath + '</code>)' : '')
      + ' &ndash; <button id="ts-notice-load">Load image</button>';
    wrap.parentElement.insertBefore(notice, wrap.nextSibling);
    document.getElementById('ts-notice-load').addEventListener('click', () => {
      $('ts-load-img-input').click();
    });
    return;
  }
  tsCanvas.width  = img.naturalWidth  || ts.sheetWidth;
  tsCanvas.height = img.naturalHeight || ts.sheetHeight;
  tCtx.drawImage(img, 0, 0);

  // Grid (with margin/spacing support)
  tCtx.strokeStyle = 'rgba(255,255,255,0.15)';
  tCtx.lineWidth = 0.5;
  const tilesPerRowG = getTilesPerRow(ts);
  const tilesPerColG = Math.max(1, Math.floor((tsCanvas.height - 2 * (ts.margin || 0) + (ts.spacing || 0)) / (ts.tileHeight + (ts.spacing || 0))));
  for (let gx = 0; gx <= tilesPerRowG; gx++) {
    const px = getTilePixelX(ts, gx);
    tCtx.beginPath(); tCtx.moveTo(px, 0); tCtx.lineTo(px, tsCanvas.height); tCtx.stroke();
  }
  for (let gy = 0; gy <= tilesPerColG; gy++) {
    const py = getTilePixelY(ts, gy);
    tCtx.beginPath(); tCtx.moveTo(0, py); tCtx.lineTo(tsCanvas.width, py); tCtx.stroke();
  }

  // Selection highlight
  updateTsOverlay();
}

function updateTsOverlay() {
  const ts = getActiveTilesheet();
  if (!ts) { tsOverlay.style.display = 'none'; return; }
  const x = getTilePixelX(ts, state.selTile.x);
  const y = getTilePixelY(ts, state.selTile.y);
  tsOverlay.style.display  = 'block';
  tsOverlay.style.left     = x + 'px';
  tsOverlay.style.top      = y + 'px';
  tsOverlay.style.width    = ts.tileWidth  + 'px';
  tsOverlay.style.height   = ts.tileHeight + 'px';
}

// ===========================================================================
// UI rendering
// ===========================================================================

function renderLayerList() {
  layerList.innerHTML = '';
  if (!state.map) return;
  // Render layers in reverse order (top-most first visually)
  const layers = [...state.map.layers].reverse();
  const realLen = state.map.layers.length;
  layers.forEach((layer, revIdx) => {
    const realIdx = realLen - 1 - revIdx;
    const item = document.createElement('div');
    item.className = 'layer-item' +
      (realIdx === state.activeLayer ? ' selected' : '') +
      (!layer.visible ? ' hidden' : '');

    const eye = document.createElement('span');
    eye.className = 'layer-vis';
    eye.textContent = layer.visible ? 'V' : 'H';
    eye.title = 'Toggle visibility';
    eye.addEventListener('click', e => {
      e.stopPropagation();
      pushUndo();
      layer.visible = !layer.visible;
      renderLayerList();
      renderMap();
    });

    const name = document.createElement('span');
    name.className = 'layer-name ellipsis';
    name.textContent = layer.id;

    const size = document.createElement('span');
    size.className = 'layer-size';
    size.textContent = `${layer.layerWidth}x${layer.layerHeight}`;

    item.append(eye, name, size);
    item.addEventListener('click', () => {
      state.activeLayer = realIdx;
      renderLayerList();
      renderProps();
      renderMap();
    });
    layerList.appendChild(item);
  });
}

function renderTsSelect() {
  tsSelect.innerHTML = '';
  if (!state.map) return;
  state.map.tilesheets.forEach((ts, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    const missing = state.tileMissing[ts.id];
    opt.textContent = missing ? `[!] ${ts.id} (Missing: ${ts.imagePath || ts.id})` : ts.id;
    if (i === state.activeTsIndex) opt.selected = true;
    tsSelect.appendChild(opt);
  });
  if (!state.map.tilesheets.length) {
    const opt = document.createElement('option');
    opt.textContent = '(no tilesheets)';
    opt.disabled = true;
    tsSelect.appendChild(opt);
  }
}

function renderProps() {
  propsDiv.innerHTML = '';
  if (!state.map) return;
  const layer = getActiveLayer();
  if (!layer) return;

  const props = layer.props || {};
  for (const [k, v] of Object.entries(props)) {
    const row = document.createElement('div');
    row.className = 'prop-row';

    const keyEl = document.createElement('input');
    keyEl.className = 'prop-key';
    keyEl.value = k;
    keyEl.readOnly = true;

    const valEl = document.createElement('input');
    valEl.className = 'prop-val';
    valEl.value = String(v);
    valEl.addEventListener('change', () => {
      pushUndo();
      const oldKey = keyEl.value;
      delete layer.props[oldKey];
      layer.props[oldKey] = parseTypedValue(valEl.value);
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'prop-delete';
    delBtn.textContent = 'X';
    delBtn.addEventListener('click', () => {
      pushUndo();
      delete layer.props[k];
      renderProps();
    });

    row.append(keyEl, valEl, delBtn);
    propsDiv.appendChild(row);
  }

  // Add property row
  const addRow = document.createElement('div');
  addRow.className = 'add-prop-row';
  const keyIn = document.createElement('input');
  keyIn.placeholder = 'key';
  const valIn = document.createElement('input');
  valIn.placeholder = 'value';
  const addBtn = document.createElement('button');
  addBtn.textContent = '+';
  addBtn.addEventListener('click', () => {
    if (!keyIn.value.trim()) return;
    pushUndo();
    layer.props[keyIn.value.trim()] = parseTypedValue(valIn.value);
    keyIn.value = ''; valIn.value = '';
    renderProps();
  });
  addRow.append(keyIn, valIn, addBtn);
  propsDiv.appendChild(addRow);
}

function renderMapInfo() {
  if (!state.map) {
    infoId.textContent = '-';
    infoSize.textContent = '-';
    infoLayers.textContent = '0';
    infoTsheets.textContent = '0';
    return;
  }
  const layer = state.map.layers[0];
  infoId.textContent      = state.map.id;
  infoSize.textContent    = layer ? `${layer.layerWidth}x${layer.layerHeight}` : '-';
  infoLayers.textContent  = state.map.layers.length;
  infoTsheets.textContent = state.map.tilesheets.length;
}

function renderAll() {
  renderLayerList();
  renderTsSelect();
  renderTileset();
  renderProps();
  renderTileInspector();
  renderMapInfo();
  renderMap();
}

// --- Tile inspector -------------------------------------------------------

// Cached frame row elements for the current inspected animated tile,
// populated by renderTileInspector() and used by updateAnimInspector().
let _inspectorAnimRows = [];

function renderTileInspector() {
  _inspectorAnimRows = [];
  inspectorDiv.innerHTML = '';
  if (!state.map || !state.inspectedTileCoord) {
    inspectorDiv.innerHTML = '<div class="inspector-hint">Click a tile to inspect</div>';
    return;
  }
  const layer = getActiveLayer();
  if (!layer) {
    inspectorDiv.innerHTML = '<div class="inspector-hint">No active layer</div>';
    return;
  }
  const { x, y } = state.inspectedTileCoord;
  if (x < 0 || y < 0 || x >= layer.layerWidth || y >= layer.layerHeight) {
    inspectorDiv.innerHTML = '<div class="inspector-hint">Out of bounds</div>';
    return;
  }
  const tile = layer.tiles[y * layer.layerWidth + x];
  if (!tile || tile.isNull) {
    inspectorDiv.innerHTML = '<div class="inspector-hint">Null tile at ' + x + ',' + y + '</div>';
    return;
  }

  // Location
  const locTitle = document.createElement('div');
  locTitle.className = 'inspector-section-title';
  locTitle.textContent = `Tile [${x}, ${y}] - ${layer.id}`;
  inspectorDiv.appendChild(locTitle);

  // Basic info
  function addRow(k, v, editable) {
    const row = document.createElement('div');
    row.className = 'inspector-row';
    const keyEl = document.createElement('div');
    keyEl.className = 'inspector-key';
    keyEl.textContent = k;
    const valEl = document.createElement('input');
    valEl.className = 'inspector-val';
    valEl.value = String(v);
    valEl.readOnly = !editable;
    if (editable) {
      valEl.addEventListener('change', () => {
        pushUndo();
        applyParsedPropToTile(tile, k, valEl.value);
        renderMap();
      });
    }
    row.append(keyEl, valEl);
    inspectorDiv.appendChild(row);
  }

  if (tile.isAnimated) {
    addRow('type', 'animated', false);
    addRow('frames', tile.frames ? tile.frames.length : 0, false);
    addRow('interval (ms)', tile.frameInterval > 0 ? tile.frameInterval : DEFAULT_FRAME_INTERVAL_MS, false);

    // Current frame indicator (updated live by updateAnimInspector during animation)
    const cfRow = document.createElement('div');
    cfRow.className = 'inspector-row';
    const cfKey = document.createElement('div');
    cfKey.className = 'inspector-key';
    cfKey.textContent = 'current frame';
    const cfVal = document.createElement('div');
    cfVal.className = 'inspector-val';
    cfVal.id = 'inspector-anim-curframe';
    if (state.animPreview && tile.frames && tile.frames.length > 0) {
      const interval = (tile.frameInterval > 0) ? tile.frameInterval : DEFAULT_FRAME_INTERVAL_MS;
      cfVal.textContent = String(Math.floor(state.animTime / interval) % tile.frames.length);
    } else {
      cfVal.textContent = '0';
    }
    cfRow.append(cfKey, cfVal);
    inspectorDiv.appendChild(cfRow);

    if (tile.frames && tile.frames.length > 0) {
      const frameTitle = document.createElement('div');
      frameTitle.className = 'inspector-section-title';
      frameTitle.textContent = 'Frames (Tilesheet : Index)';
      inspectorDiv.appendChild(frameTitle);
      tile.frames.forEach((fr, fi) => {
        const frow = document.createElement('div');
        frow.className = 'inspector-anim-row';
        frow.dataset.frameIdx = fi;
        frow.innerHTML = `<strong>#${fi}</strong>&nbsp;${fr.tilesheet} : <strong>${fr.tileIndex}</strong>`;
        inspectorDiv.appendChild(frow);
        _inspectorAnimRows.push(frow);
      });
    }
  } else {
    addRow('type', 'static', false);
    addRow('tilesheet', tile.staticTilesheet || '', false);
    addRow('tileIndex', tile.staticIndex !== undefined ? tile.staticIndex : -1, false);
    addRow('blendMode', tile.blendMode || 0, false);
  }

  // Tile properties
  const props = tile.props || {};
  const propKeys = Object.keys(props);
  const propsTitle = document.createElement('div');
  propsTitle.className = 'inspector-section-title';
  propsTitle.textContent = 'Tile Properties';
  inspectorDiv.appendChild(propsTitle);

  if (propKeys.length === 0) {
    const noProps = document.createElement('div');
    noProps.className = 'inspector-hint';
    noProps.style.padding = '4px 0';
    noProps.textContent = '(no tile properties)';
    inspectorDiv.appendChild(noProps);
  } else {
    propKeys.forEach(k => {
      const row = document.createElement('div');
      row.className = 'inspector-row-editable';
      const keyEl = document.createElement('div');
      keyEl.className = 'inspector-key';
      keyEl.textContent = k;
      const valEl = document.createElement('input');
      valEl.className = 'inspector-val';
      valEl.value = String(props[k]);
      valEl.addEventListener('change', () => {
        pushUndo();
        tile.props = tile.props || {};
        tile.props[k] = parseTypedValue(valEl.value);
        renderMap();
      });
      const delBtn = document.createElement('button');
      delBtn.className = 'prop-delete';
      delBtn.title = 'Delete property';
      delBtn.textContent = '✕';
      delBtn.addEventListener('click', () => {
        pushUndo();
        delete tile.props[k];
        renderTileInspector();
        renderMap();
      });
      row.append(keyEl, valEl, delBtn);
      inspectorDiv.appendChild(row);
    });
  }

  // Add new tile property
  const addTitle = document.createElement('div');
  addTitle.className = 'inspector-section-title';
  addTitle.textContent = 'Add Property';
  inspectorDiv.appendChild(addTitle);

  const sdvProps = ['Passable', 'WaterTile', 'NoRender', 'NPCBarrier', 'Diggable', 'CannotPass',
                    'Tillable', 'Placeable', 'Friction', 'Shadow', 'PathType',
                    'Action', 'TouchAction', 'Layer'];
  const addRow2 = document.createElement('div');
  addRow2.className = 'add-prop-row';
  const keyIn = document.createElement('input');
  keyIn.placeholder = 'key';
  keyIn.setAttribute('list', 'sdv-prop-keys');
  const dl = document.createElement('datalist');
  dl.id = 'sdv-prop-keys';
  sdvProps.forEach(p => { const opt = document.createElement('option'); opt.value = p; dl.appendChild(opt); });
  const valIn = document.createElement('input');
  valIn.placeholder = 'value';
  const addBtn = document.createElement('button');
  addBtn.textContent = '+';
  addBtn.addEventListener('click', () => {
    if (!keyIn.value.trim()) return;
    pushUndo();
    tile.props = tile.props || {};
    tile.props[keyIn.value.trim()] = parseTypedValue(valIn.value);
    keyIn.value = ''; valIn.value = '';
    renderTileInspector();
    renderMap();
  });
  addRow2.append(keyIn, dl, valIn, addBtn);
  inspectorDiv.appendChild(addRow2);

  // --- Animation editor section (create / edit animations) ---
  if (animationEditor) {
    animationEditor.reset();
    const animSection = animationEditor.buildSection(tile, layer, x, y);
    inspectorDiv.appendChild(animSection);
  }
}

function parseTypedValue(str) {
  if (str === 'true'  || str === 'T') return true;
  if (str === 'false' || str === 'F') return false;
  if (str !== '' && !isNaN(Number(str))) {
    return Number(str);
  }
  return str;
}

function applyParsedPropToTile(tile, key, strVal) {
  tile.props = tile.props || {};
  tile.props[key] = parseTypedValue(strVal);
}

function afterMapChange() {
  state.inspectedTileCoord = null;
  state.tsCache = {};
  renderAll();
}

// ===========================================================================
// Status helpers
// ===========================================================================

function setStatus(msg, type = 'ok') {
  statusMsg.textContent = msg;
  statusMsg.className   = 'status-' + type;
}

// ===========================================================================
// .tbin I/O via FileReader (browser)
// ===========================================================================

function loadMapFromArrayBuffer(buf, fileName) {
  // Use the JS fallback inline (avoid require in browser)
  try {
    const map = parseTbin(buf);
    state.map = map;
    state.activeLayer  = 0;
    state.activeTsIndex = 0;
    state.undoStack    = [];
    state.redoStack    = [];
    state.dirty        = false;
    state.filePath     = fileName || null;
    state.inspectedTileCoord = null;
    // Mark all tilesheets as missing until we resolve them
    state.tileMissing = {};
    for (const ts of map.tilesheets) {
      if (!state.tileImages[ts.id]) {
        state.tileMissing[ts.id] = true;
      }
    }
    fitToWindow();
    afterMapChange();

    // Auto-start animation preview if the map contains animated tiles
    if (mapHasAnimations(map) && !state.animPreview) {
      state.animPreview = true;
      const animBtn = $('btn-anim-prev');
      if (animBtn) animBtn.classList.add('active');
      startAnimLoop();
    }

    // Try to auto-load any missing tilesheets via the asset library, then
    // show the missing-tilesheet dialog only for those that couldn't be resolved.
    if (assetManager && map.tilesheets.length > 0) {
      assetManager.autoLoadTilesheets(map.tilesheets).then(({ loaded, missing }) => {
        if (loaded.length > 0) {
          // Re-render now that images are available
          renderAll();
        }
        const missingCount = missing.length;
        if (missingCount > 0) {
          setStatus(
            `Loaded: ${fileName || 'map'} - ${missingCount} tilesheet image(s) missing. Use [Img] or add images to assets/tilesheets/.`,
            'warn'
          );
          showMissingTilesheetDialog();
        } else if (Object.keys(state.tileMissing).length === 0) {
          setStatus(`Loaded: ${fileName || 'map'}`, 'ok');
        }
      });
    } else {
      const missingCount = Object.keys(state.tileMissing).length;
      if (missingCount > 0) {
        setStatus(
          `Loaded: ${fileName || 'map'} - ${missingCount} tilesheet image(s) missing. Use [Img] to load.`,
          'warn'
        );
        // Auto-show missing tilesheet dialog for any missing tilesheet
        showMissingTilesheetDialog();
      } else {
        setStatus(`Loaded: ${fileName || 'map'}`, 'ok');
      }
    }
  } catch (e) {
    setStatus('Error loading .tbin: ' + e.message, 'err');
    console.error(e);
  }
}

function mapToArrayBuffer(map) {
  return encodeTbin(map);
}

// ===========================================================================
// Missing Tilesheet Dialog
// ===========================================================================

function showMissingTilesheetDialog(tsId) {
  const ts = tsId
    ? state.map && state.map.tilesheets.find(t => t.id === tsId)
    : state.map && state.map.tilesheets.find(t => state.tileMissing[t.id]);
  if (!ts) return;

  const msgEl = $('ts-missing-msg');
  if (assetManager) {
    msgEl.textContent = assetManager.buildMissingMessage(ts);
  } else {
    msgEl.textContent = 'Tilesheet "' + ts.id + '" expects image at: '
      + (ts.imagePath || ts.id)
      + '. Please select the image file to load.';
  }

  $('modal-ts-missing').classList.remove('hidden');

  // One-shot handlers
  const onSelect = () => {
    $('modal-ts-missing').classList.add('hidden');
    cleanup();
    // Temporarily switch to this tilesheet so ts-load-img-input loads into it
    const idx = state.map.tilesheets.indexOf(ts);
    if (idx >= 0) state.activeTsIndex = idx;
    $('ts-load-img-input').click();
  };
  const onCancel = () => {
    $('modal-ts-missing').classList.add('hidden');
    cleanup();
  };
  function cleanup() {
    $('ts-missing-select').removeEventListener('click', onSelect);
    $('ts-missing-cancel').removeEventListener('click', onCancel);
  }
  $('ts-missing-select').addEventListener('click', onSelect);
  $('ts-missing-cancel').addEventListener('click', onCancel);
}

// ===========================================================================
// Pure JS .tbin parser (browser-safe, mirrors tbin-js-fallback.js)
// ===========================================================================

/** Returns true if `map` contains at least one animated tile. */
function mapHasAnimations(map) {
  if (!map) return false;
  for (const layer of map.layers) {
    for (const tile of layer.tiles) {
      if (tile && tile.isAnimated && tile.frames && tile.frames.length > 0) return true;
    }
  }
  return false;
}

function parseTbin(ab) {
  const view    = new DataView(ab);
  const decoder = new TextDecoder('utf-8');
  let pos       = 0;

  function ru8()  { return view.getUint8(pos++); }
  function ri32() { const v = view.getInt32(pos, true); pos += 4; return v; }
  function rf32() { const v = view.getFloat32(pos, true); pos += 4; return v; }
  function rstr() {
    const len = ri32();
    const s   = decoder.decode(new Uint8Array(ab, pos, len));
    pos += len; return s;
  }
  function rv2i() { return { x: ri32(), y: ri32() }; }

  const magicBuf = new Uint8Array(ab, 0, 6);
  const magic    = String.fromCharCode(...magicBuf);
  pos            = 6;
  if (magic !== 'tBIN10') throw new Error('Not a valid .tbin file');

  // Property types (PropertyValue.hpp enum): Bool=0, Integer=1, Float=2, String=3
  function readProps() {
    const count = ri32(), props = {};
    for (let i = 0; i < count; i++) {
      const k = rstr(), t = ru8();
      if      (t === 0) props[k] = ru8() > 0;   // Bool
      else if (t === 1) props[k] = ri32();        // Integer
      else if (t === 2) props[k] = rf32();        // Float
      else if (t === 3) props[k] = rstr();        // String
      else throw new Error(`Unknown prop type ${t}`);
    }
    return props;
  }

  const map = { id: rstr(), desc: rstr(), props: readProps(), tilesheets: [], layers: [] };

  const tsCount = ri32();
  for (let ti = 0; ti < tsCount; ti++) {
    const ts = { id: rstr(), desc: rstr(), imagePath: rstr() };
    const sh = rv2i(); ts.sheetWidth = sh.x; ts.sheetHeight = sh.y;
    const tl = rv2i(); ts.tileWidth  = tl.x; ts.tileHeight  = tl.y;
    const mg = rv2i(); ts.margin   = mg.x; ts.marginY  = mg.y;
    const sp = rv2i(); ts.spacing  = sp.x; ts.spacingY = sp.y;
    ts.props = readProps();
    map.tilesheets.push(ts);
  }

  const layerCount = ri32();
  for (let li = 0; li < layerCount; li++) {
    // Layer order: id, visible(u8), desc, layerSize, tileSize, props
    const layer = { id: rstr(), visible: ru8() > 0, desc: rstr() };
    const ls = rv2i(); layer.layerWidth = ls.x; layer.layerHeight = ls.y;
    const ts = rv2i(); layer.tileWidth  = ts.x; layer.tileHeight  = ts.y;
    layer.props = readProps();

    const total = layer.layerWidth * layer.layerHeight;
    layer.tiles = new Array(total).fill(null).map(() => ({ isNull: true }));
    let currTs = '';

    // Tile markers (ASCII chars): 'N'=null run, 'T'=tilesheet, 'S'=static, 'A'=animated
    for (let iy = 0; iy < layer.layerHeight; iy++) {
      let ix = 0;
      while (ix < layer.layerWidth) {
        const c = ru8();
        if (c === 0x4E) { // 'N' - null run
          ix += ri32();
        } else if (c === 0x54) { // 'T' - set tilesheet
          currTs = rstr();
        } else if (c === 0x53) { // 'S' - static tile
          const tile = { isNull: false, isAnimated: false, staticTilesheet: currTs };
          tile.staticIndex = ri32();
          tile.blendMode   = ru8();
          tile.props       = readProps();
          layer.tiles[ix + iy * layer.layerWidth] = tile;
          ix++;
        } else if (c === 0x41) { // 'A' - animated tile
          const tile = { isNull: false, isAnimated: true, frames: [] };
          tile.frameInterval = ri32();
          const fc           = ri32();
          let   frameTs      = currTs;
          let   readFrames   = 0;
          while (readFrames < fc) {
            const fc2 = ru8();
            if (fc2 === 0x54) { frameTs = rstr(); }       // 'T'
            else if (fc2 === 0x53) {                       // 'S'
              const fi = ri32(); ru8(); readProps();       // tileIndex, blendMode, props
              tile.frames.push({ tilesheet: frameTs, tileIndex: fi });
              readFrames++;
            } else { throw new Error(`Bad animated frame marker 0x${fc2.toString(16)}`); }
          }
          tile.props = readProps();
          layer.tiles[ix + iy * layer.layerWidth] = tile;
          ix++;
        } else {
          throw new Error(`Bad tile marker 0x${c.toString(16)} at [${ix},${iy}]`);
        }
      }
    }
    map.layers.push(layer);
  }
  return map;
}

function encodeTbin(map) {
  const chunks = [];
  const enc = new TextEncoder();

  function wu8(v)  { chunks.push(new Uint8Array([v & 0xFF])); }
  function wi32(v) { const b = new ArrayBuffer(4); new DataView(b).setInt32(0, v, true); chunks.push(new Uint8Array(b)); }
  function wf32(v) { const b = new ArrayBuffer(4); new DataView(b).setFloat32(0, v, true); chunks.push(new Uint8Array(b)); }
  function wstr(s) { const e = enc.encode(s); wi32(e.length); chunks.push(e); }
  function wv2i(v) { wi32(v.x); wi32(v.y); }

  // Property types: Bool=0, Integer=1, Float=2, String=3
  function wprops(props) {
    const keys = Object.keys(props || {});
    wi32(keys.length);
    for (const k of keys) {
      wstr(k);
      const v = props[k];
      if (typeof v === 'boolean') { wu8(0); wu8(v ? 1 : 0); }
      else if (Number.isInteger(v)) { wu8(1); wi32(v); }
      else if (typeof v === 'number') { wu8(2); wf32(v); }
      else { wu8(3); wstr(String(v)); }
    }
  }

  chunks.push(enc.encode('tBIN10'));
  wstr(map.id || '');
  wstr(map.desc || '');
  wprops(map.props);

  wi32((map.tilesheets || []).length);
  for (const ts of (map.tilesheets || [])) {
    wstr(ts.id || ''); wstr(ts.desc || ''); wstr(ts.imagePath || '');
    wv2i({ x: ts.sheetWidth || 0,  y: ts.sheetHeight || 0 });
    wv2i({ x: ts.tileWidth  || 16, y: ts.tileHeight  || 16 });
    wv2i({ x: ts.margin  || 0, y: ts.marginY  || 0 });
    wv2i({ x: ts.spacing || 0, y: ts.spacingY || 0 });
    wprops(ts.props);
  }

  wi32((map.layers || []).length);
  for (const layer of (map.layers || [])) {
    wstr(layer.id || '');
    wu8(layer.visible !== false ? 1 : 0);
    wstr(layer.desc || '');
    wv2i({ x: layer.layerWidth  || 0, y: layer.layerHeight || 0 });
    wv2i({ x: layer.tileWidth   || 16, y: layer.tileHeight || 16 });
    wprops(layer.props);

    // Write tiles row by row using ASCII markers
    let currTs = '';
    for (let iy = 0; iy < (layer.layerHeight || 0); iy++) {
      let nulls = 0;
      for (let ix = 0; ix < (layer.layerWidth || 0); ix++) {
        const t = (layer.tiles || [])[ix + iy * layer.layerWidth];
        if (!t || t.isNull) { nulls++; continue; }

        if (nulls > 0) { wu8(0x4E); wi32(nulls); nulls = 0; } // 'N'

        const ts = t.isAnimated
          ? (t.frames && t.frames[0] ? t.frames[0].tilesheet : '')
          : (t.staticTilesheet || '');
        if (ts !== currTs) { wu8(0x54); wstr(ts); currTs = ts; } // 'T'

        if (!t.isAnimated) {
          wu8(0x53); // 'S'
          wi32(t.staticIndex !== undefined ? t.staticIndex : -1);
          wu8(t.blendMode || 0);
          wprops(t.props);
        } else {
          wu8(0x41); // 'A'
          wi32(t.frameInterval || 100);
          wi32((t.frames || []).length);
          let frameTs = currTs;
          for (const fr of (t.frames || [])) {
            if (fr.tilesheet !== frameTs) { wu8(0x54); wstr(fr.tilesheet); frameTs = fr.tilesheet; }
            wu8(0x53); wi32(fr.tileIndex || 0); wu8(0); wprops({}); // 'S' + index + blendMode + props
          }
          wprops(t.props);
        }
      }
      if (nulls > 0) { wu8(0x4E); wi32(nulls); } // trailing nulls in row
    }
  }

  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out.buffer;
}

// ===========================================================================
// File operations
// ===========================================================================

function openFile() {
  $('file-open-input').click();
}

$('file-open-input').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  const ab = await file.arrayBuffer();
  loadMapFromArrayBuffer(ab, file.name);
  e.target.value = '';
});

function saveFile() {
  if (!state.map) { setStatus('No map to save', 'warn'); return; }
  const ab = mapToArrayBuffer(state.map);
  const blob = new Blob([ab], { type: 'application/octet-stream' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = (state.map.id || 'map') + '.tbin';
  a.click();
  URL.revokeObjectURL(url);
  state.dirty = false;
  setStatus('Saved: ' + a.download, 'ok');
}

function exportJson() {
  if (!state.map) { setStatus('No map to export', 'warn'); return; }
  const json = JSON.stringify(state.map, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = (state.map.id || 'map') + '.json';
  a.click();
  URL.revokeObjectURL(url);
  setStatus('Exported JSON: ' + a.download, 'ok');
}

// ===========================================================================
// Zoom / Pan
// ===========================================================================

function setZoom(z, pivotX, pivotY) {
  const oldZoom = state.zoom;
  const newZoom = Math.max(0.1, Math.min(8, z));
  if (newZoom === oldZoom) return;

  // Zoom toward the pivot point; default to centre of the canvas area
  if (pivotX === undefined) {
    const rect = canvasArea.getBoundingClientRect();
    pivotX = rect.width  / 2;
    pivotY = rect.height / 2;
  }

  state.pan.x = pivotX - (pivotX - state.pan.x) * (newZoom / oldZoom);
  state.pan.y = pivotY - (pivotY - state.pan.y) * (newZoom / oldZoom);
  state.zoom  = newZoom;
  zoomDisplay.textContent = Math.round(state.zoom * 100) + '%';
  renderMap();
}

function fitToWindow() {
  if (!state.map || !state.map.layers.length) return;
  const layer = state.map.layers[0];
  const mapW  = layer.layerWidth  * layer.tileWidth;
  const mapH  = layer.layerHeight * layer.tileHeight;
  const rect  = canvasArea.getBoundingClientRect();
  const scale = Math.min(rect.width / mapW, rect.height / mapH, 2) * 0.9;
  state.zoom  = scale;
  state.pan.x = (rect.width  - mapW * scale) / 2;
  state.pan.y = (rect.height - mapH * scale) / 2;
  zoomDisplay.textContent = Math.round(state.zoom * 100) + '%';
  renderMap();
}

// ===========================================================================
// Canvas mouse events (map)
// ===========================================================================

function canvasTileCoords(e) {
  const rect = mapCanvas.getBoundingClientRect();
  const cx   = (e.clientX - rect.left - state.pan.x) / state.zoom;
  const cy   = (e.clientY - rect.top  - state.pan.y) / state.zoom;
  const layer = getActiveLayer();
  if (!layer) return null;
  const tx = Math.floor(cx / layer.tileWidth);
  const ty = Math.floor(cy / layer.tileHeight);
  if (tx < 0 || ty < 0 || tx >= layer.layerWidth || ty >= layer.layerHeight) return null;
  return { x: tx, y: ty };
}

function paintTile(tx, ty) {
  const layer = getActiveLayer();
  const ts    = getActiveTilesheet();
  if (!layer || !ts) return;
  const tilesPerRow = getTilesPerRow(ts);
  const idx   = state.selTile.y * tilesPerRow + state.selTile.x;
  const tileIdx = ty * layer.layerWidth + tx;
  layer.tiles[tileIdx] = {
    isNull:          false,
    isAnimated:      false,
    staticTilesheet: ts.id,
    staticIndex:     idx,
    blendMode:       0,
    props:           {},
  };
  renderMap();
}

function eraseTile(tx, ty) {
  const layer = getActiveLayer();
  if (!layer) return;
  layer.tiles[ty * layer.layerWidth + tx] = { isNull: true };
  renderMap();
}

function floodFill(tx, ty) {
  const layer = getActiveLayer();
  const ts    = getActiveTilesheet();
  if (!layer || !ts) return;

  const tilesPerRow = getTilesPerRow(ts);
  const newIdx      = state.selTile.y * tilesPerRow + state.selTile.x;
  const targetTile  = layer.tiles[ty * layer.layerWidth + tx];
  const targetKey   = tileKey(targetTile);

  const newTile = () => ({
    isNull: false, isAnimated: false,
    staticTilesheet: ts.id, staticIndex: newIdx,
    blendMode: 0, props: {},
  });

  if (tileKey(newTile()) === targetKey) return; // nothing to do

  const queue = [[tx, ty]];
  while (queue.length) {
    const [cx, cy] = queue.shift();
    if (cx < 0 || cy < 0 || cx >= layer.layerWidth || cy >= layer.layerHeight) continue;
    const i = cy * layer.layerWidth + cx;
    if (tileKey(layer.tiles[i]) !== targetKey) continue;
    layer.tiles[i] = newTile();
    queue.push([cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]);
  }
  renderMap();
}

function tileKey(tile) {
  if (!tile || tile.isNull) return '__null__';
  if (tile.isAnimated) return 'anim:' + tile.frames.map(f => f.tilesheet + ':' + f.tileIndex).join(',');
  return tile.staticTilesheet + ':' + tile.staticIndex;
}

function eyedrop(tx, ty) {
  const layer = getActiveLayer();
  if (!layer) return;
  const tile = layer.tiles[ty * layer.layerWidth + tx];
  if (!tile || tile.isNull) return;
  const tsId = tile.isAnimated
    ? (tile.frames && tile.frames[0] ? tile.frames[0].tilesheet : null)
    : tile.staticTilesheet;
  const tileIdx = tile.isAnimated
    ? (tile.frames && tile.frames[0] ? tile.frames[0].tileIndex : -1)
    : tile.staticIndex;
  if (!tsId || tileIdx < 0) return;
  const tsI = state.map.tilesheets.findIndex(t => t.id === tsId);
  if (tsI < 0) return;
  const ts = state.map.tilesheets[tsI];
  const tilesPerRow = getTilesPerRow(ts);
  state.activeTsIndex = tsI;
  state.selTile = { x: tileIdx % tilesPerRow, y: Math.floor(tileIdx / tilesPerRow) };
  tsSelect.value = tsI;
  renderTileset();
  setStatus(`Picked tile from ${tsId} #${tileIdx}`, 'ok');
}

mapCanvas.addEventListener('mousedown', e => {
  if (e.button === 1 || (e.button === 0 && e.altKey)) {
    // Pan mode
    state.isDragging = true;
    state.dragStart  = { x: e.clientX - state.pan.x, y: e.clientY - state.pan.y };
    mapCanvas.style.cursor = 'grabbing';
    return;
  }
  if (e.button !== 0) return;
  const tc = canvasTileCoords(e);
  if (!tc) return;
  state.isPainting = true;
  pushUndo();
  applyTool(tc.x, tc.y);
});

mapCanvas.addEventListener('mousemove', e => {
  if (state.isDragging) {
    state.pan.x = e.clientX - state.dragStart.x;
    state.pan.y = e.clientY - state.dragStart.y;
    renderMap();
    return;
  }
  const tc = canvasTileCoords(e);
  state.hoverTile = tc;
  if (tc) {
    statusCursor.textContent = `Tile: ${tc.x},${tc.y}`;
    if (state.isPainting) applyTool(tc.x, tc.y);
  } else {
    statusCursor.textContent = '-';
  }
  renderMap();
});

mapCanvas.addEventListener('mouseup', e => {
  state.isPainting = false;
  if (state.isDragging) {
    state.isDragging = false;
    mapCanvas.style.cursor = '';
  }
});

mapCanvas.addEventListener('mouseleave', () => {
  state.hoverTile  = null;
  state.isPainting = false;
  statusCursor.textContent = '-';
  renderMap();
});

mapCanvas.addEventListener('wheel', e => {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.1 : 0.9;
  const rect = mapCanvas.getBoundingClientRect();
  setZoom(state.zoom * factor, e.clientX - rect.left, e.clientY - rect.top);
}, { passive: false });

function applyTool(tx, ty) {
  switch (state.tool) {
    case 'paint':   paintTile(tx, ty);  break;
    case 'erase':   eraseTile(tx, ty);  break;
    case 'fill':    floodFill(tx, ty);  break;
    case 'eyedrop': eyedrop(tx, ty);    break;
    case 'tiledata': {
      const layer = getActiveLayer();
      if (layer && tileDataEditor) {
        if (tileDataEditor.eraseMode) {
          tileDataEditor.erase(tx, ty, layer);
        } else {
          tileDataEditor.paint(tx, ty, layer);
        }
        renderMap();
      }
      break;
    }
    case 'select':
      // Update tile inspector on click
      state.inspectedTileCoord = { x: tx, y: ty };
      renderTileInspector();
      renderMap(); // update selection highlight
      break;
    default: break;
  }
  if (state.map) {
    const layer = getActiveLayer();
    if (layer) {
      const tile = layer.tiles[ty * layer.layerWidth + tx];
      if (tile && !tile.isNull) {
        statusTile.textContent = tile.isAnimated
          ? `Animated (${tile.frames.length} frames)`
          : `${tile.staticTilesheet}#${tile.staticIndex}`;
      } else {
        statusTile.textContent = 'null';
      }
    }
  }
}

// ===========================================================================
// Tileset canvas events
// ===========================================================================

tsCanvas.addEventListener('click', e => {
  const ts = getActiveTilesheet();
  if (!ts) return;
  const rect    = tsCanvas.getBoundingClientRect();
  const px      = e.clientX - rect.left;
  const py      = e.clientY - rect.top;
  const margin  = ts.margin  || 0;
  const spacing = ts.spacing || 0;
  const tileStep = ts.tileWidth  + spacing;
  const tileStepY= ts.tileHeight + spacing;
  const x = Math.max(0, Math.floor((px - margin) / tileStep));
  const y = Math.max(0, Math.floor((py - margin) / tileStepY));
  const tilesPerRow = getTilesPerRow(ts);
  const idx = y * tilesPerRow + x;

  // If animation editor is waiting for a frame, intercept this click
  if (animationEditor && animationEditor.onTilesheetClick(ts.id, idx)) return;

  state.selTile = { x, y };
  updateTsOverlay();
  setStatus('Selected tile ' + x + ',' + y + ' in ' + ts.id, 'ok');
});

tsSelect.addEventListener('change', () => {
  state.activeTsIndex = parseInt(tsSelect.value, 10) || 0;
  state.selTile = { x: 0, y: 0 };
  renderTileset();
});

// ===========================================================================
// Toolbar buttons
// ===========================================================================

document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.tool = btn.dataset.tool;
    statusTool.textContent = btn.title.split(' ')[0] || state.tool;
    const cursors = { select: 'default', paint: 'crosshair', erase: 'cell', fill: 'copy', eyedrop: 'zoom-in' };
    mapCanvas.style.cursor = cursors[state.tool] || 'crosshair';
  });
});

$('btn-undo').addEventListener('click', undo);
$('btn-redo').addEventListener('click', redo);

$('btn-zoom-in').addEventListener('click',  () => setZoom(state.zoom * 1.25));
$('btn-zoom-out').addEventListener('click', () => setZoom(state.zoom * 0.8));
$('btn-zoom-fit').addEventListener('click', fitToWindow);

$('btn-grid').addEventListener('click', () => {
  state.showGrid = !state.showGrid;
  $('btn-grid').classList.toggle('active', state.showGrid);
  renderMap();
});
$('btn-grid').classList.add('active');

// --- Collision overlay toggle --------------------------------------------

$('btn-collision').addEventListener('click', () => {
  state.showCollision = !state.showCollision;
  $('btn-collision').classList.toggle('active', state.showCollision);
  renderMap();
});

// --- Animation preview toggle --------------------------------------------

$('btn-anim-prev').addEventListener('click', () => {
  state.animPreview = !state.animPreview;
  $('btn-anim-prev').classList.toggle('active', state.animPreview);
  if (state.animPreview) {
    startAnimLoop();
  } else {
    stopAnimLoop();
    renderMap();
  }
});

// --- TileData overlay toggle ---------------------------------------------

$('btn-tiledata').addEventListener('click', () => {
  state.showTileData = !state.showTileData;
  $('btn-tiledata').classList.toggle('active', state.showTileData);
  // Show/hide the TileData sidebar panel
  const tdPanel = document.getElementById('tiledata-panel-section');
  if (tdPanel) tdPanel.style.display = state.showTileData ? 'flex' : 'none';
  renderMap();
});

function startAnimLoop() {
  if (state.animTimer !== null) return;
  let startTime = null;
  function loop(ts) {
    try {
      if (!state.animPreview) { state.animTimer = null; return; }
      if (startTime === null) startTime = ts;
      state.animTime = ts - startTime;
      renderMap();
      updateAnimInspector();
      state.animTimer = requestAnimationFrame(loop);
    } catch (e) {
      console.error('Animation loop error:', e);
      state.animPreview = false;
      state.animTimer = null;
      $('btn-anim-prev').classList.remove('active');
    }
  }
  state.animTimer = requestAnimationFrame(loop);
}

function stopAnimLoop() {
  if (state.animTimer !== null) {
    cancelAnimationFrame(state.animTimer);
    state.animTimer = null;
  }
  state.animTime = 0;
}

// Lightweight update of the current-frame indicator in the tile inspector.
// Called every animation frame to avoid a full inspector rebuild.
function updateAnimInspector() {
  if (!state.animPreview || !state.inspectedTileCoord) return;
  const layer = getActiveLayer();
  if (!layer) return;
  const { x, y } = state.inspectedTileCoord;
  if (x < 0 || y < 0 || x >= layer.layerWidth || y >= layer.layerHeight) return;
  const tile = layer.tiles[y * layer.layerWidth + x];
  if (!tile || tile.isNull || !tile.isAnimated || !tile.frames || tile.frames.length === 0) return;
  const interval = (tile.frameInterval > 0) ? tile.frameInterval : DEFAULT_FRAME_INTERVAL_MS;
  const frameIdx = Math.floor(state.animTime / interval) % tile.frames.length;
  const curFrameEl = document.getElementById('inspector-anim-curframe');
  if (curFrameEl) curFrameEl.textContent = String(frameIdx);
  // Highlight the active frame row using cached elements (no querySelectorAll at 60fps)
  for (let i = 0; i < _inspectorAnimRows.length; i++) {
    _inspectorAnimRows[i].classList.toggle('active', i === frameIdx);
  }
}

// --- Season selector -----------------------------------------------------

document.querySelectorAll('.season-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.season-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.season = btn.dataset.season;
    // Update map season property if a map is loaded and season prop exists
    if (state.map) {
      state.map.props = state.map.props || {};
      if ('season' in state.map.props) {
        pushUndo();
        state.map.props.season = state.season;
      }
    }
    setStatus(`Season: ${state.season}`, 'ok');
  });
});

// ===========================================================================
// Header buttons
// ===========================================================================

$('btn-new').addEventListener('click', () => {
  $('modal-new').classList.remove('hidden');
});
$('btn-open').addEventListener('click', openFile);
$('btn-save').addEventListener('click', saveFile);
$('btn-saveas').addEventListener('click', saveFile);
$('btn-export').addEventListener('click', exportJson);

// New map modal
$('new-cancel').addEventListener('click', () => $('modal-new').classList.add('hidden'));
$('new-create').addEventListener('click', () => {
  const id     = $('new-map-id').value.trim()   || 'NewMap';
  const desc   = $('new-map-desc').value.trim();
  const w      = parseInt($('new-map-w').value, 10)    || 30;
  const h      = parseInt($('new-map-h').value, 10)    || 20;
  const tSize  = parseInt($('new-tile-size').value, 10) || 16;
  state.map         = createEmptyMap(id, desc, w, h, tSize, tSize);
  state.activeLayer = 0;
  state.activeTsIndex = 0;
  state.undoStack   = [];
  state.redoStack   = [];
  state.dirty       = false;
  state.filePath    = null;
  $('modal-new').classList.add('hidden');
  fitToWindow();
  afterMapChange();
  setStatus(`Created: ${id} (${w}x${h})`, 'ok');
});

// ===========================================================================
// Layer panel buttons
// ===========================================================================

$('btn-layer-add').addEventListener('click', () => {
  if (!state.map) { setStatus('Open or create a map first', 'warn'); return; }
  $('modal-add-layer').classList.remove('hidden');
});

$('add-layer-cancel').addEventListener('click', () => $('modal-add-layer').classList.add('hidden'));
$('add-layer-ok').addEventListener('click', () => {
  const id   = $('new-layer-id').value.trim()   || 'Layer';
  const desc = $('new-layer-desc').value.trim();
  const ref  = state.map.layers[0] || { layerWidth: 30, layerHeight: 20, tileWidth: 16, tileHeight: 16 };
  pushUndo();
  const layer = createLayer(id, ref.layerWidth, ref.layerHeight, ref.tileWidth, ref.tileHeight);
  layer.desc = desc;
  state.map.layers.push(layer);
  state.activeLayer = state.map.layers.length - 1;
  $('modal-add-layer').classList.add('hidden');
  renderAll();
  setStatus(`Added layer: ${id}`, 'ok');
});

$('btn-layer-del').addEventListener('click', () => {
  if (!state.map || state.map.layers.length <= 1) { setStatus('Cannot delete the last layer', 'warn'); return; }
  pushUndo();
  state.map.layers.splice(state.activeLayer, 1);
  state.activeLayer = Math.min(state.activeLayer, state.map.layers.length - 1);
  renderAll();
});

$('btn-layer-up').addEventListener('click', () => {
  const layers = state.map && state.map.layers;
  if (!layers || state.activeLayer <= 0) return;
  pushUndo();
  [layers[state.activeLayer], layers[state.activeLayer - 1]] =
  [layers[state.activeLayer - 1], layers[state.activeLayer]];
  state.activeLayer--;
  renderAll();
});

$('btn-layer-down').addEventListener('click', () => {
  const layers = state.map && state.map.layers;
  if (!layers || state.activeLayer >= layers.length - 1) return;
  pushUndo();
  [layers[state.activeLayer], layers[state.activeLayer + 1]] =
  [layers[state.activeLayer + 1], layers[state.activeLayer]];
  state.activeLayer++;
  renderAll();
});

// ===========================================================================
// Tilesheet buttons
// ===========================================================================

$('btn-ts-add').addEventListener('click', () => {
  if (!state.map) { setStatus('Open or create a map first', 'warn'); return; }
  $('modal-add-ts').classList.remove('hidden');
});

$('add-ts-cancel').addEventListener('click', () => $('modal-add-ts').classList.add('hidden'));
$('add-ts-ok').addEventListener('click', () => {
  const id      = $('ts-id').value.trim() || 'tilesheet';
  const tw      = parseInt($('ts-tw').value, 10) || 16;
  const th      = parseInt($('ts-th').value, 10) || 16;
  const margin  = parseInt($('ts-margin').value, 10) || 0;
  const spacing = parseInt($('ts-spacing').value, 10) || 0;
  const file    = $('ts-file').files[0];

  if (!file) { setStatus('Please select an image file', 'warn'); return; }

  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      pushUndo();
      const ts = {
        id,
        desc:        '',
        imagePath:   file.name,
        sheetWidth:  img.naturalWidth,
        sheetHeight: img.naturalHeight,
        tileWidth:   tw,
        tileHeight:  th,
        margin:      margin,
        spacing:     spacing,
        props:       {},
      };
      state.map.tilesheets.push(ts);
      state.tileImages[id]   = img;
      state.activeTsIndex    = state.map.tilesheets.length - 1;
      $('modal-add-ts').classList.add('hidden');
      renderAll();
      setStatus('Imported tilesheet: ' + id, 'ok');
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
});

$('btn-ts-del').addEventListener('click', () => {
  if (!state.map || !state.map.tilesheets.length) return;
  const ts = state.map.tilesheets[state.activeTsIndex];
  if (!ts) return;
  $('ts-del-msg').textContent = 'Remove tilesheet "' + ts.id + '"? Tiles referencing this tilesheet will lose their image.';
  $('modal-ts-confirm-del').classList.remove('hidden');
});

$('ts-del-cancel').addEventListener('click', () => {
  $('modal-ts-confirm-del').classList.add('hidden');
});
$('ts-del-confirm').addEventListener('click', () => {
  $('modal-ts-confirm-del').classList.add('hidden');
  if (!state.map || !state.map.tilesheets.length) return;
  pushUndo();
  const id = state.map.tilesheets[state.activeTsIndex].id;
  state.map.tilesheets.splice(state.activeTsIndex, 1);
  if (assetManager) {
    assetManager.evict(id);
  } else {
    delete state.tileImages[id];
    delete state.tileMissing[id];
  }
  state.activeTsIndex = 0;
  renderAll();
  setStatus('Removed tilesheet: ' + id, 'ok');
});

// --- Load image for existing tilesheet -----------------------------------

$('btn-ts-load-img').addEventListener('click', () => {
  if (!state.map || !state.map.tilesheets.length) {
    setStatus('No tilesheet selected', 'warn');
    return;
  }
  $('ts-load-img-input').click();
});

$('ts-load-img-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const ts = getActiveTilesheet();
  if (!ts) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      // Custom images always override library images
      if (assetManager) {
        assetManager.storeCustomImage(ts.id, img);
      } else {
        state.tileImages[ts.id] = img;
        delete state.tileMissing[ts.id];
      }
      // Always update sheet dimensions from the actual image (image is source of truth)
      ts.sheetWidth  = img.naturalWidth;
      ts.sheetHeight = img.naturalHeight;
      renderAll();
      setStatus('Loaded image for tilesheet: ' + ts.id, 'ok');
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
  e.target.value = '';
});

// --- Tileset canvas drag-and-drop -----------------------------------------

const tsCanvasWrap = document.getElementById('tileset-canvas-wrap');

tsCanvasWrap.addEventListener('dragover', e => {
  e.preventDefault();
  const dt = e.dataTransfer;
  if (dt && dt.items && [...dt.items].some(i => i.kind === 'file' && i.type.startsWith('image/'))) {
    tsCanvasWrap.classList.add('ts-drag-over');
  }
});

tsCanvasWrap.addEventListener('dragleave', e => {
  if (!tsCanvasWrap.contains(e.relatedTarget)) {
    tsCanvasWrap.classList.remove('ts-drag-over');
  }
});

tsCanvasWrap.addEventListener('drop', e => {
  e.preventDefault();
  e.stopPropagation(); // Don't let the global drop handler catch it
  tsCanvasWrap.classList.remove('ts-drag-over');
  const file = e.dataTransfer && e.dataTransfer.files[0];
  if (!file || !file.type.startsWith('image/')) return;
  if (!state.map) { setStatus('Open or create a map first to load a tilesheet image', 'warn'); return; }

  const ts = getActiveTilesheet();
  if (!ts) {
    // No tilesheet selected - prompt user to create one
    setStatus('No tilesheet selected. Use [+] to import a new tilesheet first.', 'warn');
    return;
  }

  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      // Custom images always override library images
      if (assetManager) {
        assetManager.storeCustomImage(ts.id, img);
      } else {
        state.tileImages[ts.id] = img;
        delete state.tileMissing[ts.id];
      }
      ts.sheetWidth  = img.naturalWidth;
      ts.sheetHeight = img.naturalHeight;
      renderAll();
      setStatus('Dropped image loaded for tilesheet: ' + ts.id, 'ok');
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
});

// --- Tileset canvas hover tooltip -----------------------------------------

const tsTileTooltip = $('tileset-tile-tooltip');

tsCanvas.addEventListener('mousemove', e => {
  const ts = getActiveTilesheet();
  if (!ts) { tsTileTooltip.style.display = 'none'; return; }
  const img = state.tileImages[ts.id];
  if (!img || !img.complete) { tsTileTooltip.style.display = 'none'; return; }
  const rect    = tsCanvas.getBoundingClientRect();
  const cx      = e.clientX - rect.left;
  const cy      = e.clientY - rect.top;
  const margin  = ts.margin  || 0;
  const spacing = ts.spacing || 0;
  const tileStep = ts.tileWidth  + spacing;
  const tileStepY= ts.tileHeight + spacing;
  const tx = Math.max(0, Math.floor((cx - margin) / tileStep));
  const ty = Math.max(0, Math.floor((cy - margin) / tileStepY));
  const tilesPerRow = getTilesPerRow(ts);
  const idx = ty * tilesPerRow + tx;
  tsTileTooltip.textContent = 'Tile #' + idx + ' (' + tx + ',' + ty + ')';
  tsTileTooltip.style.display = 'block';
  // Position inside the wrap, relative to canvas
  const wrapRect = tsCanvasWrap.getBoundingClientRect();
  const tipX = (e.clientX - wrapRect.left) + 10;
  const tipY = (e.clientY - wrapRect.top)  + 14;
  tsTileTooltip.style.left = tipX + 'px';
  tsTileTooltip.style.top  = tipY + 'px';
});

tsCanvas.addEventListener('mouseleave', () => {
  tsTileTooltip.style.display = 'none';
});

// --- Tileset context menu -------------------------------------------------

const tsContextMenu = $('ts-context-menu');

function hideContextMenu() {
  tsContextMenu.classList.add('hidden');
}

tsCanvas.addEventListener('contextmenu', e => {
  e.preventDefault();
  if (!state.map || !state.map.tilesheets.length) return;
  // Position the menu at cursor
  tsContextMenu.style.left = e.clientX + 'px';
  tsContextMenu.style.top  = e.clientY + 'px';
  tsContextMenu.classList.remove('hidden');
});

document.addEventListener('click', e => {
  if (!tsContextMenu.classList.contains('hidden') && !tsContextMenu.contains(e.target)) {
    hideContextMenu();
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') hideContextMenu();
}, true);

$('ctx-load-img').addEventListener('click', () => {
  hideContextMenu();
  if (!state.map || !state.map.tilesheets.length) return;
  $('ts-load-img-input').click();
});

$('ctx-rename').addEventListener('click', () => {
  hideContextMenu();
  const ts = getActiveTilesheet();
  if (!ts) return;
  const newId = prompt('Rename tilesheet "' + ts.id + '" to:', ts.id);
  if (!newId || newId === ts.id) return;
  pushUndo();
  // Update all tile references to the old id
  for (const layer of state.map.layers) {
    for (const tile of layer.tiles) {
      if (!tile || tile.isNull) continue;
      if (!tile.isAnimated && tile.staticTilesheet === ts.id) tile.staticTilesheet = newId;
      if (tile.isAnimated && tile.frames) {
        for (const fr of tile.frames) {
          if (fr.tilesheet === ts.id) fr.tilesheet = newId;
        }
      }
    }
  }
  // Move the image cache entry
  if (assetManager) {
    const img = state.tileImages[ts.id];
    if (img) { assetManager.storeCustomImage(newId, img); assetManager.evict(ts.id); }
    else if (state.tileMissing[ts.id]) { state.tileMissing[newId] = true; delete state.tileMissing[ts.id]; }
  } else {
    if (state.tileImages[ts.id]) { state.tileImages[newId] = state.tileImages[ts.id]; delete state.tileImages[ts.id]; }
    if (state.tileMissing[ts.id]) { state.tileMissing[newId] = true; delete state.tileMissing[ts.id]; }
  }
  ts.id = newId;
  renderAll();
  setStatus('Renamed tilesheet to: ' + newId, 'ok');
});

$('ctx-remove').addEventListener('click', () => {
  hideContextMenu();
  $('btn-ts-del').click(); // reuse the confirmation dialog
});

$('ctx-export-img').addEventListener('click', () => {
  hideContextMenu();
  const ts = getActiveTilesheet();
  if (!ts) return;
  const img = state.tileImages[ts.id];
  if (!img || !img.complete) { setStatus('No image loaded for tilesheet: ' + ts.id, 'warn'); return; }
  // Draw to a temp canvas and export
  const tmpCanvas = document.createElement('canvas');
  tmpCanvas.width  = img.naturalWidth;
  tmpCanvas.height = img.naturalHeight;
  tmpCanvas.getContext('2d').drawImage(img, 0, 0);
  tmpCanvas.toBlob(blob => {
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href     = url;
    a.download = ts.id + '.png';
    a.click();
    URL.revokeObjectURL(url);
    setStatus('Exported tilesheet image: ' + ts.id + '.png', 'ok');
  }, 'image/png');
});

// --- Map properties modal ------------------------------------------------

$('btn-map-props').addEventListener('click', () => {
  if (!state.map) { setStatus('Open or create a map first', 'warn'); return; }
  const props = state.map.props || {};
  $('mp-id').value       = state.map.id   || '';
  $('mp-desc').value     = state.map.desc || '';
  $('mp-music').value    = String(props['Music']    || '');
  $('mp-ambience').value = String(props['Ambience'] || '');
  $('mp-season').value   = String(props['season']   || '');
  $('modal-map-props').classList.remove('hidden');
});

$('mp-cancel').addEventListener('click', () => $('modal-map-props').classList.add('hidden'));
$('mp-ok').addEventListener('click', () => {
  if (!state.map) return;
  pushUndo();
  state.map.id   = $('mp-id').value.trim()   || state.map.id;
  state.map.desc = $('mp-desc').value.trim();
  state.map.props = state.map.props || {};
  const music    = $('mp-music').value.trim();
  const ambience = $('mp-ambience').value.trim();
  const season   = $('mp-season').value;
  if (music)    state.map.props['Music']    = music;
  else          delete state.map.props['Music'];
  if (ambience) state.map.props['Ambience'] = ambience;
  else          delete state.map.props['Ambience'];
  if (season)   state.map.props['season']   = season;
  else          delete state.map.props['season'];
  $('modal-map-props').classList.add('hidden');
  renderAll();
  setStatus(`Map properties updated: ${state.map.id}`, 'ok');
});

// ===========================================================================
// Properties: add button
// ===========================================================================

$('btn-prop-add').addEventListener('click', () => {
  const input = propsDiv.querySelector('.add-prop-row input');
  if (input) input.focus();
});

// ===========================================================================
// Keyboard shortcuts
// ===========================================================================

document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.key === 'z') { e.preventDefault(); undo(); return; }
  if (ctrl && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); redo(); return; }
  if (ctrl && e.key === 's') { e.preventDefault(); saveFile(); return; }
  if (ctrl && e.key === 'o') { e.preventDefault(); openFile(); return; }
  if (ctrl && e.key === 'n') { e.preventDefault(); $('modal-new').classList.remove('hidden'); return; }

  switch (e.key.toLowerCase()) {
    case 's': setActiveTool('select');  break;
    case 'p': setActiveTool('paint');   break;
    case 'e': setActiveTool('erase');   break;
    case 'f': setActiveTool('fill');    break;
    case 'i': setActiveTool('eyedrop'); break;
    case 'g': $('btn-grid').click();    break;
    case '+':
    case '=': setZoom(state.zoom * 1.25); break;
    case '-': setZoom(state.zoom * 0.8);  break;
    case '0': fitToWindow(); break;
  }
});

function setActiveTool(tool) {
  const btn = document.querySelector(`.tool-btn[data-tool="${tool}"]`);
  if (btn) btn.click();
}

// ===========================================================================
// Touch events (mobile / tablet support) – handled via TouchHandler component
// ===========================================================================

// TouchHandler is initialised in the init() function at the bottom of this file.
// The callbacks below translate generic gesture events into editor actions.

function initTouchHandler() {
  touchHandler = new TouchHandler(mapCanvas, {
    /** Single-finger tap: start painting or selecting */
    onTap(clientX, clientY) {
      const tc = canvasTileCoords({ clientX, clientY });
      if (!tc) return;
      state.isPainting = true;
      pushUndo();
      applyTool(tc.x, tc.y);
    },

    /** Single-finger drag: continue paint stroke */
    onDrag(clientX, clientY) {
      if (!state.isPainting) return;
      const tc = canvasTileCoords({ clientX, clientY });
      state.hoverTile = tc;
      if (tc) {
        statusCursor.textContent = `Tile: ${tc.x},${tc.y}`;
        applyTool(tc.x, tc.y);
      }
    },

    /** Pan the map by (dx, dy) CSS pixels */
    onPan(dx, dy) {
      state.pan.x += dx;
      state.pan.y += dy;
      renderMap();
    },

    /** 2-finger pinch zoom toward (pivotX, pivotY) relative to canvas */
    onPinchZoom(factor, pivotX, pivotY) {
      setZoom(state.zoom * factor, pivotX, pivotY);
    },

    /** All fingers lifted */
    onEnd() {
      state.isPainting = false;
    },

    /** Long-press (500 ms) – show a simple context hint */
    onLongPress(clientX, clientY) {
      const tc = canvasTileCoords({ clientX, clientY });
      if (tc) {
        state.inspectedTileCoord = { x: tc.x, y: tc.y };
        renderTileInspector();
        renderMap();
        setStatus(`Long-pressed tile ${tc.x},${tc.y}`, 'ok');
      }
    },

    /**
     * Returns true when a single-finger drag should pan instead of paint.
     * Currently: pan mode is active when the "select" tool is chosen.
     */
    getIsPanMode() {
      return state.tool === 'select';
    },
  });
  touchHandler.init();
}

// ===========================================================================
// Drag & drop .tbin files
// ===========================================================================

document.addEventListener('dragover', e => {
  e.preventDefault(); // Always call to allow drops anywhere
  // Show body drag-over highlight only when NOT over the tileset canvas wrap
  if (!tsCanvasWrap.contains(e.target)) {
    document.body.classList.add('drag-over');
  }
});
document.addEventListener('dragleave', e => {
  if (!e.relatedTarget) document.body.classList.remove('drag-over');
});
document.addEventListener('drop', async e => {
  // If dropped on tileset canvas wrap, that handler already processed it
  if (tsCanvasWrap.contains(e.target)) return;
  e.preventDefault();
  document.body.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (!file) return;
  if (file.name.endsWith('.tbin')) {
    const ab = await file.arrayBuffer();
    loadMapFromArrayBuffer(ab, file.name);
  } else if (file.name.endsWith('.json')) {
    const text = await file.text();
    state.map = JSON.parse(text);
    state.activeLayer = 0;
    state.activeTsIndex = 0;
    fitToWindow();
    afterMapChange();
    setStatus('Loaded JSON map: ' + file.name, 'ok');
  } else {
    setStatus('Unsupported file type (expected .tbin or .json)', 'warn');
  }
});

// ===========================================================================
// Resize observer
// ===========================================================================

new ResizeObserver(resizeCanvas).observe(canvasArea);

// ===========================================================================
// Init
// ===========================================================================

(function init() {
  // Instantiate components
  tileDataEditor = new TileDataEditor(state, { renderMap, pushUndo, setStatus });
  animationEditor = new AnimationEditor(state, {
    renderMap, renderTileInspector, pushUndo, setStatus, getTilesPerRow,
  });

  // Inject TileData sidebar panel into the right panel (initially hidden)
  const tdPanelSection = document.getElementById('tiledata-panel-section');
  if (tdPanelSection && tileDataEditor) {
    tdPanelSection.appendChild(tileDataEditor.buildPanel());
    tdPanelSection.style.display = 'none'; // hidden until TD button is pressed
  }

  // Initialise touch handler
  initTouchHandler();

  resizeCanvas();
  renderLayerList();
  renderTsSelect();
  renderProps();
  renderTileInspector();
  renderMapInfo();
  setStatus('Ready - open a .tbin file or create a new map (Ctrl+N)', 'ok');

  // Welcome render
  renderMap();
})();
