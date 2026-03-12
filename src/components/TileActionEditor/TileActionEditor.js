'use strict';

/**
 * TileActionEditor
 * Manages Stardew Valley Tile Action properties stored in tile.props:
 *   Warp, Action, TouchAction, Event, PassableByFish, BanMonstersHere, etc.
 *
 * In the .tbin binary these are stored as named string/bool/int props on each
 * tile (tile.props).  This component provides:
 *   - A colour-coded badge overlay on the map canvas (showOverlay)
 *   - Hover tooltips showing the full action value(s)
 *   - A "tileaction" tool (tool === 'tileaction') for clicking tiles to
 *     add / edit / delete actions
 *   - A sidebar panel with action-type selector and value input
 *   - Inspector section shown inside the Tile Inspector panel
 *   - Undo/Redo support via callbacks.pushUndo()
 */
class TileActionEditor {
  /**
   * @param {object} state      - Shared editor state object
   * @param {object} callbacks  - { renderMap, pushUndo, setStatus, renderTileInspector }
   */
  constructor(state, callbacks) {
    this.state     = state;
    this.callbacks = callbacks;

    /** Whether the Tile Action overlay is rendered on the map. */
    this.showOverlay = false;

    /** When true, clicking a tile removes the selected action key. */
    this.eraseMode = false;

    /**
     * Known Stardew Valley Tile Action property types.
     *   key:        property name stored in tile.props
     *   color:      semi-transparent RGBA for the overlay badge background
     *   badgeColor: solid hex / CSS color for the legend dot
     *   label:      single-character label shown inside the badge
     */
    this.ACTION_TYPES = [
      { key: 'Warp',            color: 'rgba(30,120,255,0.72)',  badgeColor: '#1e78ff', label: 'W' },
      { key: 'Action',          color: 'rgba(40,180,40,0.72)',   badgeColor: '#28b428', label: 'A' },
      { key: 'TouchAction',     color: 'rgba(255,140,0,0.72)',   badgeColor: '#ff8c00', label: 'T' },
      { key: 'Event',           color: 'rgba(147,112,219,0.72)', badgeColor: '#9370db', label: 'E' },
      { key: 'PassableByFish',  color: 'rgba(100,200,220,0.72)', badgeColor: '#64c8dc', label: 'F' },
      { key: 'BanMonstersHere', color: 'rgba(220,60,60,0.72)',   badgeColor: '#dc3c3c', label: 'B' },
    ];

    /** Fraction of the smaller tile dimension used for each badge side. */
    this.BADGE_SIZE_RATIO = 0.35;

    /** Fraction of badgeSize used for the label font size. */
    this.BADGE_FONT_RATIO = 0.72;

    /** Maximum number of action badges rendered per tile. */
    this.MAX_VISIBLE_BADGES = 4;

    /** The action property key currently selected for painting */
    this.paintKey   = 'Warp';

    /** The string value to paint */
    this.paintValue = '';

    // DOM references (set in buildPanel / buildInspectorSection)
    this._keySel  = null;
    this._valIn   = null;
    this._panel   = null;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Returns all action entries for a tile as [{key, value}].
   * Returns an empty array when the tile is null or has no action props.
   * @param {object} tile
   * @returns {{ key: string, value: * }[]}
   */
  getTileActions(tile) {
    if (!tile || tile.isNull || !tile.props) return [];
    return this.ACTION_TYPES
      .filter(a => a.key in tile.props)
      .map(a => ({ key: a.key, value: tile.props[a.key] }));
  }

  /**
   * Returns tooltip text for the tile at (tx, ty) in layer, or null when the
   * tile has no action properties.
   * @param {number} tx
   * @param {number} ty
   * @param {object} layer
   * @returns {string|null}
   */
  getTooltip(tx, ty, layer) {
    if (!layer || !layer.tiles) return null;
    if (tx < 0 || ty < 0 || tx >= layer.layerWidth || ty >= layer.layerHeight) return null;
    const tile    = layer.tiles[ty * layer.layerWidth + tx];
    const actions = this.getTileActions(tile);
    if (actions.length === 0) return null;
    return actions.map(a => `${a.key}: "${a.value}"`).join('\n');
  }

  // ---------------------------------------------------------------------------
  // Map rendering – colour-coded corner badge per action
  // ---------------------------------------------------------------------------

  /**
   * Render small colour-coded badges in the top-right corner of every tile
   * that has at least one action property.  Called from renderMap() after all
   * tile layers are drawn.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} layer
   */
  renderOverlay(ctx, layer) {
    if (!this.showOverlay) return;

    const tw = layer.tileWidth;
    const th = layer.tileHeight;
    // Badge = square occupying BADGE_SIZE_RATIO of the smaller tile dimension
    const badgeSize = Math.max(4, Math.min(tw, th) * this.BADGE_SIZE_RATIO);
    const fontSize  = Math.max(4, badgeSize * this.BADGE_FONT_RATIO);

    ctx.save();
    ctx.font         = `bold ${fontSize}px system-ui`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';

    for (let ty = 0; ty < layer.layerHeight; ty++) {
      for (let tx = 0; tx < layer.layerWidth; tx++) {
        const tile    = layer.tiles[ty * layer.layerWidth + tx];
        const actions = this.getTileActions(tile);
        if (actions.length === 0) continue;

        // Draw one badge per action (up to MAX_VISIBLE_BADGES), stacked left-to-right in the
        // top-right corner of the tile.
        const maxBadges = Math.min(actions.length, this.MAX_VISIBLE_BADGES);
        for (let i = 0; i < maxBadges; i++) {
          const aType = this._typeMap[actions[i].key];
          if (!aType) continue;
          // Right-align: rightmost badge flush with right edge of tile
          const bx = tx * tw + tw - badgeSize * (i + 1);
          const by = ty * th;
          ctx.fillStyle = aType.color;
          ctx.fillRect(bx, by, badgeSize, badgeSize);
          ctx.fillStyle = '#fff';
          ctx.fillText(aType.label, bx + badgeSize / 2, by + badgeSize / 2);
        }
      }
    }

    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Painting / erasing (used by the 'tileaction' tool)
  // ---------------------------------------------------------------------------

  /**
   * Add (or update) the selected action property on the tile at (tx, ty).
   * If the tile is null, warns the user; action props require a visible tile.
   *
   * @param {number} tx
   * @param {number} ty
   * @param {object} layer
   */
  paint(tx, ty, layer) {
    const tile = layer.tiles[ty * layer.layerWidth + tx];
    if (!tile || tile.isNull) {
      this.callbacks.setStatus(
        'Cannot add action to an empty tile — paint a tile first (Pen tool)',
        'warn'
      );
      return;
    }
    tile.props = tile.props || {};
    tile.props[this.paintKey] = this.paintValue;
    this.callbacks.setStatus(
      `Set ${this.paintKey} on [${tx},${ty}]: "${this.paintValue}"`, 'ok'
    );
  }

  /**
   * Remove the selected action property from the tile at (tx, ty).
   *
   * @param {number} tx
   * @param {number} ty
   * @param {object} layer
   */
  erase(tx, ty, layer) {
    const tile = layer.tiles[ty * layer.layerWidth + tx];
    if (!tile || tile.isNull || !tile.props) return;
    if (this.paintKey in tile.props) {
      delete tile.props[this.paintKey];
      this.callbacks.setStatus(`Removed ${this.paintKey} from [${tx},${ty}]`, 'ok');
    }
  }

  // ---------------------------------------------------------------------------
  // Sidebar panel (shown when the TA overlay toggle is active)
  // ---------------------------------------------------------------------------

  /**
   * Build and return the Tile Action sidebar panel DOM element.
   * Should be inserted once into the right panel; no further calls needed.
   * @returns {HTMLElement}
   */
  buildPanel() {
    const wrap = document.createElement('div');
    wrap.id        = 'tileaction-panel';
    wrap.className = 'panel-section';

    // --- Header ---
    const header = document.createElement('div');
    header.className   = 'panel-header';
    header.textContent = 'Tile Actions';
    wrap.appendChild(header);

    // --- Content ---
    const content = document.createElement('div');
    content.className = 'tileaction-content';

    // Action type selector
    content.appendChild(this._lbl('Action Type:'));
    const keySel = document.createElement('select');
    keySel.id        = 'tileaction-key-select';
    keySel.className = 'tileaction-select';
    this._keySel = keySel;

    this.ACTION_TYPES.forEach(a => {
      const opt       = document.createElement('option');
      opt.value       = a.key;
      opt.textContent = a.key;
      keySel.appendChild(opt);
    });

    // Separator + custom option
    const sep = document.createElement('option');
    sep.disabled    = true;
    sep.textContent = '──────────';
    keySel.appendChild(sep);

    const custOpt       = document.createElement('option');
    custOpt.value       = '__custom__';
    custOpt.textContent = '(custom key…)';
    keySel.appendChild(custOpt);

    keySel.value = this.paintKey;

    const customWrap = document.createElement('div');
    customWrap.className     = 'tileaction-custom-row';
    customWrap.style.display = 'none';
    const customIn       = document.createElement('input');
    customIn.className   = 'tileaction-input';
    customIn.placeholder = 'Custom property key…';
    customIn.addEventListener('change', () => {
      const k = customIn.value.trim();
      if (k) this.paintKey = k;
    });
    customWrap.appendChild(customIn);

    keySel.addEventListener('change', () => {
      if (keySel.value === '__custom__') {
        customWrap.style.display = 'flex';
        return;
      }
      customWrap.style.display = 'none';
      this.paintKey = keySel.value;
    });

    content.appendChild(keySel);
    content.appendChild(customWrap);

    // Value input
    content.appendChild(this._lbl('Value:'));
    const valIn       = document.createElement('input');
    valIn.id          = 'tileaction-val-input';
    valIn.className   = 'tileaction-input';
    valIn.placeholder = 'e.g. 13 61 Town 22 9';
    valIn.value       = this.paintValue;
    this._valIn = valIn;
    valIn.addEventListener('input', () => { this.paintValue = valIn.value; });
    content.appendChild(valIn);

    // Erase-mode toggle
    const eraseLabel = document.createElement('label');
    eraseLabel.className = 'tileaction-checkbox-row';
    const eraseChk   = document.createElement('input');
    eraseChk.type    = 'checkbox';
    eraseChk.id      = 'tileaction-erase-mode';
    eraseChk.addEventListener('change', () => { this.eraseMode = eraseChk.checked; });
    eraseLabel.append(eraseChk, ' Erase mode');
    content.appendChild(eraseLabel);

    // Colour legend
    const legend = document.createElement('div');
    legend.className = 'tileaction-legend';
    this.ACTION_TYPES.forEach(a => {
      const item  = document.createElement('div');
      item.className = 'tileaction-legend-item';
      const dot   = document.createElement('span');
      dot.className = 'tileaction-legend-dot';
      dot.style.background = a.badgeColor;
      dot.textContent = a.label;
      const lbl   = document.createElement('span');
      lbl.textContent = a.key;
      item.append(dot, lbl);
      legend.appendChild(item);
    });
    content.appendChild(legend);

    // Help text
    const help         = document.createElement('div');
    help.className     = 'tileaction-help';
    help.textContent   = 'Select action type & value, use the TA✏ tool to paint. Hover tiles to see action tooltips.';
    content.appendChild(help);

    wrap.appendChild(content);
    this._panel = wrap;
    return wrap;
  }

  // ---------------------------------------------------------------------------
  // Tile Inspector section (injected into renderTileInspector)
  // ---------------------------------------------------------------------------

  /**
   * Build and return a DOM element showing the current tile's action props
   * with the ability to edit values and delete individual actions.
   *
   * @param {object} tile   - The tile object (must not be null/isNull)
   * @param {object} layer  - The layer containing the tile
   * @param {number} tx     - Tile x-coordinate
   * @param {number} ty     - Tile y-coordinate
   * @returns {HTMLElement}
   */
  buildInspectorSection(tile, layer, tx, ty) {
    const section = document.createElement('div');
    section.className = 'tileaction-inspector';

    const title       = document.createElement('div');
    title.className   = 'inspector-section-title';
    title.textContent = 'Tile Actions';
    section.appendChild(title);

    const actions = this.getTileActions(tile);

    if (actions.length === 0) {
      const none       = document.createElement('div');
      none.className   = 'inspector-hint';
      none.style.padding = '4px 0';
      none.textContent = '(no actions on this tile)';
      section.appendChild(none);
    } else {
      actions.forEach(({ key, value }) => {
        const row       = document.createElement('div');
        row.className   = 'tileaction-inspector-row';

        const aType = this._typeMap[key];
        if (aType) {
          const dot   = document.createElement('span');
          dot.className = 'tileaction-legend-dot';
          dot.style.background = aType.badgeColor;
          dot.textContent = aType.label;
          row.appendChild(dot);
        }

        const keyEl     = document.createElement('div');
        keyEl.className = 'inspector-key';
        keyEl.textContent = key;
        row.appendChild(keyEl);

        const valEl     = document.createElement('input');
        valEl.className = 'inspector-val';
        valEl.value     = String(value);
        valEl.addEventListener('change', () => {
          this.callbacks.pushUndo();
          tile.props[key] = valEl.value;
          this.callbacks.renderMap();
        });
        row.appendChild(valEl);

        const delBtn     = document.createElement('button');
        delBtn.className = 'prop-delete';
        delBtn.title     = 'Delete action';
        delBtn.textContent = '✕';
        delBtn.addEventListener('click', () => {
          this.callbacks.pushUndo();
          delete tile.props[key];
          this.callbacks.renderTileInspector();
          this.callbacks.renderMap();
        });
        row.appendChild(delBtn);

        section.appendChild(row);
      });
    }

    // "Add action" sub-form
    const addTitle       = document.createElement('div');
    addTitle.className   = 'tileaction-add-title';
    addTitle.textContent = 'Add Action:';
    section.appendChild(addTitle);

    const addRow     = document.createElement('div');
    addRow.className = 'tileaction-add-row';

    const addKeySel  = document.createElement('select');
    addKeySel.className = 'tileaction-select tileaction-select-sm';
    this.ACTION_TYPES.forEach(a => {
      const opt       = document.createElement('option');
      opt.value       = a.key;
      opt.textContent = a.key;
      addKeySel.appendChild(opt);
    });
    // Custom option
    const custSep         = document.createElement('option');
    custSep.disabled      = true;
    custSep.textContent   = '──────';
    addKeySel.appendChild(custSep);
    const custOpt2        = document.createElement('option');
    custOpt2.value        = '__custom__';
    custOpt2.textContent  = '(custom)';
    addKeySel.appendChild(custOpt2);

    const addCustomIn     = document.createElement('input');
    addCustomIn.className = 'tileaction-input';
    addCustomIn.placeholder = 'key';
    addCustomIn.style.display = 'none';
    addCustomIn.style.minWidth = '60px';

    addKeySel.addEventListener('change', () => {
      addCustomIn.style.display = addKeySel.value === '__custom__' ? 'block' : 'none';
    });

    const addValIn        = document.createElement('input');
    addValIn.className    = 'tileaction-input';
    addValIn.placeholder  = 'value';

    const addBtn          = document.createElement('button');
    addBtn.className      = 'icon-btn';
    addBtn.textContent    = '+';
    addBtn.title          = 'Add action';
    addBtn.addEventListener('click', () => {
      const key = addKeySel.value === '__custom__'
        ? addCustomIn.value.trim()
        : addKeySel.value;
      if (!key) return;
      this.callbacks.pushUndo();
      tile.props = tile.props || {};
      tile.props[key] = addValIn.value;
      addValIn.value  = '';
      this.callbacks.renderTileInspector();
      this.callbacks.renderMap();
    });

    addRow.append(addKeySel, addCustomIn, addValIn, addBtn);
    section.appendChild(addRow);

    return section;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  _lbl(text) {
    const el       = document.createElement('div');
    el.className   = 'tileaction-label';
    el.textContent = text;
    return el;
  }
}
