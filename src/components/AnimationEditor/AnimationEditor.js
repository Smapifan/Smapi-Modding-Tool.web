'use strict';

/**
 * AnimationEditor
 * Provides in-Inspector UI for creating and editing tile animations.
 *
 * - For a static tile: shows a "Create Animation" button.
 * - For an animated tile: shows an editable frame-list, interval input,
 *   "Add Frame" (tilesheet-click intercept), reorder buttons, and
 *   "Convert to Static" button.
 *
 * The component is stateless between inspector rebuilds EXCEPT for the
 * add-frame mode flag (`this.addFrameMode`).
 */
class AnimationEditor {
  /**
   * @param {object} state      - Shared editor state
   * @param {object} callbacks  - {
   *     renderMap,
   *     renderTileInspector,
   *     pushUndo,
   *     setStatus,
   *     getTilesPerRow   // function(ts) → number
   *   }
   */
  constructor(state, callbacks) {
    this.state     = state;
    this.callbacks = callbacks;

    /** Default frame interval in milliseconds when not specified. */
    this.DEFAULT_FRAME_INTERVAL = 150;

    /** When true the next tilesheet click should add a frame to editingTile. */
    this.addFrameMode = false;

    // References kept for the add-frame callback
    this.editingTile  = null;
    this.editingLayer = null;
    this.editingX     = -1;
    this.editingY     = -1;
  }

  // ---------------------------------------------------------------------------
  // Inspector section builder
  // ---------------------------------------------------------------------------

  /**
   * Build and return a DOM element that is appended to the tile inspector.
   *
   * @param {object} tile  - Live tile reference
   * @param {object} layer - Layer that owns the tile
   * @param {number} x     - Tile column
   * @param {number} y     - Tile row
   * @returns {HTMLElement}
   */
  buildSection(tile, layer, x, y) {
    this.editingTile  = tile;
    this.editingLayer = layer;
    this.editingX     = x;
    this.editingY     = y;

    const wrap = document.createElement('div');
    wrap.className = 'anim-editor-wrap';

    const title = document.createElement('div');
    title.className   = 'inspector-section-title';
    title.textContent = 'Animation';
    wrap.appendChild(title);

    if (!tile.isAnimated) {
      this._buildStaticSection(wrap, tile, layer, x, y);
    } else {
      this._buildAnimatedSection(wrap, tile, layer, x, y);
    }

    return wrap;
  }

  // ---------------------------------------------------------------------------
  // Static tile section (just a Create button)
  // ---------------------------------------------------------------------------

  _buildStaticSection(wrap, tile, layer, x, y) {
    const hint = document.createElement('div');
    hint.className   = 'inspector-hint';
    hint.textContent = 'This tile is static.';
    wrap.appendChild(hint);

    const btn = document.createElement('button');
    btn.className   = 'btn-anim-create';
    btn.textContent = '▶ Create Animation';
    btn.title       = 'Convert this static tile to an animated tile';
    btn.addEventListener('click', () => {
      this.callbacks.pushUndo();
      const anim    = this._convertToAnimated(tile, layer, x, y);
      this.editingTile = anim;
      this.addFrameMode = false;
      this.callbacks.renderTileInspector();
      this.callbacks.renderMap();
      this.callbacks.setStatus('Animation created – use "+ Add Frame" to add frames', 'ok');
    });
    wrap.appendChild(btn);
  }

  // ---------------------------------------------------------------------------
  // Animated tile section (full editor)
  // ---------------------------------------------------------------------------

  _buildAnimatedSection(wrap, tile, layer, x, y) {
    // --- Frame interval ---
    const intRow = document.createElement('div');
    intRow.className = 'inspector-row';
    const intKey = document.createElement('div');
    intKey.className   = 'inspector-key';
    intKey.textContent = 'Interval (ms)';
    const intInput = document.createElement('input');
    intInput.className = 'inspector-val';
    intInput.type      = 'number';
    intInput.min       = '1';
    intInput.max       = '60000';
    intInput.value     = String(tile.frameInterval > 0 ? tile.frameInterval : this.DEFAULT_FRAME_INTERVAL);
    intInput.addEventListener('change', () => {
      this.callbacks.pushUndo();
      tile.frameInterval = Math.max(1, parseInt(intInput.value, 10) || this.DEFAULT_FRAME_INTERVAL);
    });
    intRow.append(intKey, intInput);
    wrap.appendChild(intRow);

    // --- Frame list title ---
    const frTitle = document.createElement('div');
    frTitle.className   = 'inspector-section-title';
    frTitle.textContent = `Frames (${(tile.frames || []).length})`;
    wrap.appendChild(frTitle);

    // --- Frame rows ---
    const frameList = document.createElement('div');
    frameList.className = 'anim-frame-list';
    (tile.frames || []).forEach((fr, fi) => {
      frameList.appendChild(this._buildFrameRow(fi, fr, tile, layer, x, y));
    });
    wrap.appendChild(frameList);

    // --- Add Frame button ---
    const addBtn = document.createElement('button');
    addBtn.className   = 'btn-anim-add-frame' + (this.addFrameMode ? ' active' : '');
    addBtn.textContent = this.addFrameMode
      ? '✓ Tap tile in tilesheet…'
      : '+ Add Frame';
    addBtn.title = this.addFrameMode
      ? 'Click any tile in the left tilesheet panel to add it as a frame'
      : 'Enter add-frame mode: click a tile in the tilesheet to add it';
    addBtn.addEventListener('click', () => {
      this.addFrameMode = !this.addFrameMode;
      this.callbacks.renderTileInspector();
      if (this.addFrameMode) {
        this.callbacks.setStatus('Click a tile in the tilesheet panel to add as animation frame', 'ok');
      } else {
        this.callbacks.setStatus('Add-frame mode cancelled', 'ok');
      }
    });
    wrap.appendChild(addBtn);

    // --- Convert to Static button ---
    const toStaticBtn = document.createElement('button');
    toStaticBtn.className   = 'btn-anim-to-static';
    toStaticBtn.textContent = '⏹ Convert to Static';
    toStaticBtn.title       = 'Remove animation; keep first frame as a static tile';
    toStaticBtn.addEventListener('click', () => {
      this.callbacks.pushUndo();
      this._convertToStatic(tile, layer, x, y);
      this.addFrameMode = false;
      this.callbacks.renderTileInspector();
      this.callbacks.renderMap();
      this.callbacks.setStatus('Converted to static tile', 'ok');
    });
    wrap.appendChild(toStaticBtn);
  }

  // ---------------------------------------------------------------------------
  // Frame row
  // ---------------------------------------------------------------------------

  _buildFrameRow(fi, fr, tile, layer, x, y) {
    const row = document.createElement('div');
    row.className           = 'anim-frame-row';
    row.dataset.frameIdx    = fi;

    // Mini canvas preview
    const preview = document.createElement('canvas');
    preview.className = 'anim-frame-preview';
    preview.width     = 24;
    preview.height    = 24;
    this._drawFramePreview(preview, fr);

    // Frame info label
    const info = document.createElement('span');
    info.className   = 'anim-frame-info';
    info.textContent = `#${fi}  ${fr.tilesheet}:${fr.tileIndex}`;

    // Move-up button
    const upBtn = document.createElement('button');
    upBtn.className = 'anim-frame-btn';
    upBtn.title     = 'Move frame up';
    upBtn.textContent = '↑';
    upBtn.disabled  = (fi === 0);
    upBtn.addEventListener('click', () => {
      if (fi === 0) return;
      this.callbacks.pushUndo();
      [tile.frames[fi], tile.frames[fi - 1]] = [tile.frames[fi - 1], tile.frames[fi]];
      this.callbacks.renderTileInspector();
    });

    // Move-down button
    const dnBtn = document.createElement('button');
    dnBtn.className   = 'anim-frame-btn';
    dnBtn.title       = 'Move frame down';
    dnBtn.textContent = '↓';
    dnBtn.disabled    = (fi >= (tile.frames || []).length - 1);
    dnBtn.addEventListener('click', () => {
      if (fi >= tile.frames.length - 1) return;
      this.callbacks.pushUndo();
      [tile.frames[fi], tile.frames[fi + 1]] = [tile.frames[fi + 1], tile.frames[fi]];
      this.callbacks.renderTileInspector();
    });

    // Delete-frame button
    const delBtn = document.createElement('button');
    delBtn.className   = 'anim-frame-btn anim-frame-del';
    delBtn.title       = 'Remove this frame';
    delBtn.textContent = '✕';
    delBtn.addEventListener('click', () => {
      this.callbacks.pushUndo();
      tile.frames.splice(fi, 1);
      if (tile.frames.length === 0) {
        this._convertToStatic(tile, layer, x, y);
      }
      this.callbacks.renderTileInspector();
      this.callbacks.renderMap();
    });

    row.append(preview, info, upBtn, dnBtn, delBtn);
    return row;
  }

  // ---------------------------------------------------------------------------
  // Frame preview mini-canvas
  // ---------------------------------------------------------------------------

  _drawFramePreview(canvas, frame) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!this.state.map) return;

    const img = this.state.tileImages[frame.tilesheet];
    if (!img || !img.complete) {
      ctx.fillStyle   = '#3c3c46';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = '#e94560';
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      ctx.moveTo(4, 4);  ctx.lineTo(20, 20);
      ctx.moveTo(20, 4); ctx.lineTo(4, 20);
      ctx.stroke();
      return;
    }

    const ts = this.state.map.tilesheets.find(t => t.id === frame.tilesheet);
    if (!ts) return;

    const tilesPerRow = this.callbacks.getTilesPerRow(ts);
    const sx = (frame.tileIndex % tilesPerRow) * ts.tileWidth  + (ts.margin || 0);
    const sy = Math.floor(frame.tileIndex / tilesPerRow) * ts.tileHeight + (ts.margin || 0);

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, sx, sy, ts.tileWidth, ts.tileHeight, 0, 0, canvas.width, canvas.height);
  }

  // ---------------------------------------------------------------------------
  // Tilesheet intercept (add-frame mode)
  // ---------------------------------------------------------------------------

  /**
   * Call this from the tilesheet canvas click handler.
   * If add-frame mode is active, appends the clicked tile as a new frame
   * and returns true (the click should be consumed).
   *
   * @param {string} tsId     - Tilesheet id
   * @param {number} tileIdx  - Linear tile index in that tilesheet
   * @returns {boolean}
   */
  onTilesheetClick(tsId, tileIdx) {
    if (!this.addFrameMode || !this.editingTile || !this.editingTile.isAnimated) return false;

    this.callbacks.pushUndo();
    this.editingTile.frames = this.editingTile.frames || [];
    this.editingTile.frames.push({ tilesheet: tsId, tileIndex: tileIdx });
    this.addFrameMode = false;
    this.callbacks.renderTileInspector();
    this.callbacks.renderMap();
    this.callbacks.setStatus(
      `Frame added: ${tsId}#${tileIdx}  (${this.editingTile.frames.length} frames total)`, 'ok'
    );
    return true;
  }

  // ---------------------------------------------------------------------------
  // Conversion helpers
  // ---------------------------------------------------------------------------

  _convertToAnimated(tile, layer, x, y) {
    const frames = [];
    if (!tile.isNull && !tile.isAnimated) {
      frames.push({ tilesheet: tile.staticTilesheet || '', tileIndex: tile.staticIndex || 0 });
    }
    const animated = {
      isNull:        false,
      isAnimated:    true,
      frames,
      frameInterval: this.DEFAULT_FRAME_INTERVAL,
      props:         Object.assign({}, tile.props || {}),
    };
    layer.tiles[y * layer.layerWidth + x] = animated;
    this.editingTile = animated;
    return animated;
  }

  _convertToStatic(tile, layer, x, y) {
    const first = tile.frames && tile.frames[0];
    const staticTile = {
      isNull:           !first,
      isAnimated:       false,
      staticTilesheet:  first ? first.tilesheet : '',
      staticIndex:      first ? first.tileIndex : 0,
      blendMode:        0,
      props:            Object.assign({}, tile.props || {}),
    };
    layer.tiles[y * layer.layerWidth + x] = staticTile;
    this.editingTile = staticTile;
    return staticTile;
  }

  /** Reset editor state (called when tile selection changes). */
  reset() {
    this.addFrameMode = false;
    this.editingTile  = null;
    this.editingLayer = null;
    this.editingX     = -1;
    this.editingY     = -1;
  }
}
