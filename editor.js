/**
 * Stardew Valley Map Editor – Frontend Logic
 * Vanilla JS + HTML5 Canvas, no framework, no server.
 */

'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// State
// ═══════════════════════════════════════════════════════════════════════════

const state = {
  map: null,          // current map object
  filePath: null,     // last saved path (only in Node.js context)
  dirty: false,       // unsaved changes
  activeLayer: 0,     // index of selected layer
  activeTsIndex: 0,   // index of selected tilesheet
  selTile: { x: 0, y: 0 }, // selected tile coords in tilesheet
  selTileEnd: null,   // for multi-tile selection { x, y }
  tool: 'select',     // select | paint | erase | fill | eyedrop
  zoom: 1.0,
  pan: { x: 0, y: 0 },
  showGrid: true,
  hoverTile: null,
  isDragging: false,
  dragStart: null,
  isPainting: false,
  undoStack: [],
  redoStack: [],
  tileImages: {},     // id → HTMLImageElement
};

// ═══════════════════════════════════════════════════════════════════════════
// Node.js / Browser shim
// ═══════════════════════════════════════════════════════════════════════════

const IS_NODE = typeof process !== 'undefined' && process.versions && process.versions.node;

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

// ═══════════════════════════════════════════════════════════════════════════
// DOM references
// ═══════════════════════════════════════════════════════════════════════════

const $ = id => document.getElementById(id);
const mapCanvas    = $('map-canvas');
const tsCanvas     = $('tileset-canvas');
const tsOverlay    = $('tileset-preview-overlay');
const canvasArea   = $('canvas-area');
const layerList    = $('layer-list');
const propsDiv     = $('props-list');
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

// ═══════════════════════════════════════════════════════════════════════════
// Map model helpers
// ═══════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════
// Undo / Redo
// ═══════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════
// Rendering
// ═══════════════════════════════════════════════════════════════════════════

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

  ctx.restore();
}

function renderLayer(ctx, layer) {
  const tw = layer.tileWidth;
  const th = layer.tileHeight;
  for (let ty = 0; ty < layer.layerHeight; ty++) {
    for (let tx = 0; tx < layer.layerWidth; tx++) {
      const tile = layer.tiles[ty * layer.layerWidth + tx];
      if (!tile || tile.isNull) continue;
      const img = getTileImage(tile, tx * tw, ty * th, tw, th, ctx);
      if (img) {
        // img is drawn by getTileImage directly
      }
    }
  }
}

function getTileImage(tile, dx, dy, dw, dh, ctx) {
  if (!tile || tile.isNull) return null;
  const tsId = tile.isAnimated
    ? (tile.frames && tile.frames[0] ? tile.frames[0].tilesheet : null)
    : tile.staticTilesheet;
  const tileIdx = tile.isAnimated
    ? (tile.frames && tile.frames[0] ? tile.frames[0].tileIndex : -1)
    : tile.staticIndex;

  if (!tsId || tileIdx < 0) return null;

  const img = state.tileImages[tsId];
  if (!img || !img.complete) return null;

  // Find tilesheet metadata
  const ts = state.map.tilesheets.find(t => t.id === tsId);
  if (!ts) return null;

  const tilesPerRow = Math.floor(ts.sheetWidth / ts.tileWidth) || 1;
  const sx = (tileIdx % tilesPerRow) * ts.tileWidth;
  const sy = Math.floor(tileIdx / tilesPerRow) * ts.tileHeight;

  ctx.drawImage(img, sx, sy, ts.tileWidth, ts.tileHeight, dx, dy, dw, dh);
  return true;
}

// ─── Tilesheet canvas ─────────────────────────────────────────────────────

function renderTileset() {
  const ts = getActiveTilesheet();
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
    tCtx.fillStyle = '#444';
    tCtx.font = '12px system-ui';
    tCtx.fillText('No image loaded', 8, 36);
    return;
  }
  tsCanvas.width  = img.naturalWidth  || ts.sheetWidth;
  tsCanvas.height = img.naturalHeight || ts.sheetHeight;
  tCtx.drawImage(img, 0, 0);

  // Grid
  tCtx.strokeStyle = 'rgba(255,255,255,0.15)';
  tCtx.lineWidth = 0.5;
  for (let gx = 0; gx <= tsCanvas.width; gx += ts.tileWidth) {
    tCtx.beginPath(); tCtx.moveTo(gx, 0); tCtx.lineTo(gx, tsCanvas.height); tCtx.stroke();
  }
  for (let gy = 0; gy <= tsCanvas.height; gy += ts.tileHeight) {
    tCtx.beginPath(); tCtx.moveTo(0, gy); tCtx.lineTo(tsCanvas.width, gy); tCtx.stroke();
  }

  // Selection highlight
  updateTsOverlay();
}

function updateTsOverlay() {
  const ts = getActiveTilesheet();
  if (!ts) { tsOverlay.style.display = 'none'; return; }
  const x = state.selTile.x * ts.tileWidth;
  const y = state.selTile.y * ts.tileHeight;
  tsOverlay.style.display  = 'block';
  tsOverlay.style.left     = x + 'px';
  tsOverlay.style.top      = y + 'px';
  tsOverlay.style.width    = ts.tileWidth  + 'px';
  tsOverlay.style.height   = ts.tileHeight + 'px';
}

// ═══════════════════════════════════════════════════════════════════════════
// UI rendering
// ═══════════════════════════════════════════════════════════════════════════

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
    eye.textContent = layer.visible ? '👁' : '🚫';
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
    size.textContent = `${layer.layerWidth}×${layer.layerHeight}`;

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
    opt.textContent = ts.id;
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
      delete layer.props[k];
      layer.props[keyEl.value] = valEl.value;
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'prop-delete';
    delBtn.textContent = '✕';
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
    layer.props[keyIn.value.trim()] = valIn.value;
    keyIn.value = ''; valIn.value = '';
    renderProps();
  });
  addRow.append(keyIn, valIn, addBtn);
  propsDiv.appendChild(addRow);
}

function renderMapInfo() {
  if (!state.map) {
    infoId.textContent = '—';
    infoSize.textContent = '—';
    infoLayers.textContent = '0';
    infoTsheets.textContent = '0';
    return;
  }
  const layer = state.map.layers[0];
  infoId.textContent      = state.map.id;
  infoSize.textContent    = layer ? `${layer.layerWidth}×${layer.layerHeight}` : '—';
  infoLayers.textContent  = state.map.layers.length;
  infoTsheets.textContent = state.map.tilesheets.length;
}

function renderAll() {
  renderLayerList();
  renderTsSelect();
  renderTileset();
  renderProps();
  renderMapInfo();
  renderMap();
}

function afterMapChange() {
  renderAll();
}

// ═══════════════════════════════════════════════════════════════════════════
// Status helpers
// ═══════════════════════════════════════════════════════════════════════════

function setStatus(msg, type = 'ok') {
  statusMsg.textContent = msg;
  statusMsg.className   = 'status-' + type;
}

// ═══════════════════════════════════════════════════════════════════════════
// .tbin I/O via FileReader (browser)
// ═══════════════════════════════════════════════════════════════════════════

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
    fitToWindow();
    afterMapChange();
    setStatus(`Loaded: ${fileName || 'map'}`, 'ok');
  } catch (e) {
    setStatus('Error loading .tbin: ' + e.message, 'err');
    console.error(e);
  }
}

function mapToArrayBuffer(map) {
  return encodeTbin(map);
}

// ═══════════════════════════════════════════════════════════════════════════
// Pure JS .tbin parser (browser-safe, mirrors tbin-js-fallback.js)
// ═══════════════════════════════════════════════════════════════════════════

function parseTbin(ab) {
  const view    = new DataView(ab);
  const decoder = new TextDecoder('utf8');
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
    rv2i(); rv2i(); // margin / spacing (discard)
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
    let currTs = '', tileIdx = 0;

    // Tile markers (ASCII chars): 'N'=null run, 'T'=tilesheet, 'S'=static, 'A'=animated
    for (let iy = 0; iy < layer.layerHeight; iy++) {
      let ix = 0;
      while (ix < layer.layerWidth) {
        const c = ru8();
        if (c === 0x4E) { // 'N' – null run
          ix += ri32();
        } else if (c === 0x54) { // 'T' – set tilesheet
          currTs = rstr();
        } else if (c === 0x53) { // 'S' – static tile
          const tile = { isNull: false, isAnimated: false, staticTilesheet: currTs };
          tile.staticIndex = ri32();
          tile.blendMode   = ru8();
          tile.props       = readProps();
          layer.tiles[ix + iy * layer.layerWidth] = tile;
          ix++;
        } else if (c === 0x41) { // 'A' – animated tile
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
    wv2i({ x: 0, y: 0 }); wv2i({ x: 0, y: 0 }); // margin / spacing
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

// ═══════════════════════════════════════════════════════════════════════════
// File operations
// ═══════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════
// Zoom / Pan
// ═══════════════════════════════════════════════════════════════════════════

function setZoom(z) {
  state.zoom = Math.max(0.1, Math.min(8, z));
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

// ═══════════════════════════════════════════════════════════════════════════
// Canvas mouse events (map)
// ═══════════════════════════════════════════════════════════════════════════

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
  const tilesPerRow = Math.max(1, Math.floor(ts.sheetWidth / ts.tileWidth));
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

  const tilesPerRow = Math.max(1, Math.floor(ts.sheetWidth / ts.tileWidth));
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
  const tilesPerRow = Math.max(1, Math.floor(ts.sheetWidth / ts.tileWidth));
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
    statusCursor.textContent = '—';
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
  statusCursor.textContent = '—';
  renderMap();
});

mapCanvas.addEventListener('wheel', e => {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.1 : 0.9;
  // Zoom toward mouse position
  const rect = mapCanvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const before = { x: (mx - state.pan.x) / state.zoom, y: (my - state.pan.y) / state.zoom };
  state.zoom = Math.max(0.1, Math.min(8, state.zoom * factor));
  state.pan.x = mx - before.x * state.zoom;
  state.pan.y = my - before.y * state.zoom;
  zoomDisplay.textContent = Math.round(state.zoom * 100) + '%';
  renderMap();
}, { passive: false });

function applyTool(tx, ty) {
  switch (state.tool) {
    case 'paint':   paintTile(tx, ty);  break;
    case 'erase':   eraseTile(tx, ty);  break;
    case 'fill':    floodFill(tx, ty);  break;
    case 'eyedrop': eyedrop(tx, ty);    break;
    default: break; // select – no tile op
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

// ═══════════════════════════════════════════════════════════════════════════
// Tileset canvas events
// ═══════════════════════════════════════════════════════════════════════════

tsCanvas.addEventListener('click', e => {
  const ts = getActiveTilesheet();
  if (!ts) return;
  const rect = tsCanvas.getBoundingClientRect();
  const x = Math.floor((e.clientX - rect.left) / ts.tileWidth);
  const y = Math.floor((e.clientY - rect.top)  / ts.tileHeight);
  state.selTile = { x, y };
  updateTsOverlay();
  setStatus(`Selected tile ${x},${y} in ${ts.id}`, 'ok');
});

tsSelect.addEventListener('change', () => {
  state.activeTsIndex = parseInt(tsSelect.value, 10) || 0;
  state.selTile = { x: 0, y: 0 };
  renderTileset();
});

// ═══════════════════════════════════════════════════════════════════════════
// Toolbar buttons
// ═══════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════
// Header buttons
// ═══════════════════════════════════════════════════════════════════════════

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
  setStatus(`Created: ${id} (${w}×${h})`, 'ok');
});

// ═══════════════════════════════════════════════════════════════════════════
// Layer panel buttons
// ═══════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════
// Tilesheet buttons
// ═══════════════════════════════════════════════════════════════════════════

$('btn-ts-add').addEventListener('click', () => {
  if (!state.map) { setStatus('Open or create a map first', 'warn'); return; }
  $('modal-add-ts').classList.remove('hidden');
});

$('add-ts-cancel').addEventListener('click', () => $('modal-add-ts').classList.add('hidden'));
$('add-ts-ok').addEventListener('click', () => {
  const id    = $('ts-id').value.trim() || 'tilesheet';
  const tw    = parseInt($('ts-tw').value, 10) || 16;
  const th    = parseInt($('ts-th').value, 10) || 16;
  const file  = $('ts-file').files[0];

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
        props:       {},
      };
      state.map.tilesheets.push(ts);
      state.tileImages[id]   = img;
      state.activeTsIndex    = state.map.tilesheets.length - 1;
      $('modal-add-ts').classList.add('hidden');
      renderAll();
      setStatus(`Imported tilesheet: ${id}`, 'ok');
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
});

$('btn-ts-del').addEventListener('click', () => {
  if (!state.map || !state.map.tilesheets.length) return;
  pushUndo();
  const id = state.map.tilesheets[state.activeTsIndex].id;
  state.map.tilesheets.splice(state.activeTsIndex, 1);
  delete state.tileImages[id];
  state.activeTsIndex = 0;
  renderAll();
});

// ═══════════════════════════════════════════════════════════════════════════
// Properties: add button
// ═══════════════════════════════════════════════════════════════════════════

$('btn-prop-add').addEventListener('click', () => {
  const input = propsDiv.querySelector('.add-prop-row input');
  if (input) input.focus();
});

// ═══════════════════════════════════════════════════════════════════════════
// Keyboard shortcuts
// ═══════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════
// Drag & drop .tbin files
// ═══════════════════════════════════════════════════════════════════════════

document.addEventListener('dragover', e => {
  e.preventDefault();
  document.body.classList.add('drag-over');
});
document.addEventListener('dragleave', e => {
  if (!e.relatedTarget) document.body.classList.remove('drag-over');
});
document.addEventListener('drop', async e => {
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

// ═══════════════════════════════════════════════════════════════════════════
// Resize observer
// ═══════════════════════════════════════════════════════════════════════════

new ResizeObserver(resizeCanvas).observe(canvasArea);

// ═══════════════════════════════════════════════════════════════════════════
// Init
// ═══════════════════════════════════════════════════════════════════════════

(function init() {
  resizeCanvas();
  renderLayerList();
  renderTsSelect();
  renderProps();
  renderMapInfo();
  setStatus('Ready – open a .tbin file or create a new map (Ctrl+N)', 'ok');

  // Welcome render
  renderMap();
})();
