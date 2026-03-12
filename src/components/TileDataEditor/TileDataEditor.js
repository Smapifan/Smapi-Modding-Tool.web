'use strict';

/**
 * TileDataEditor
 * Manages Stardew Valley TileData:  tile-level property overlays
 * (LockedDoor, NPCBarrier, Passable, WaterTile, Action, …).
 *
 * In the .tbin binary, TileData is stored as tile.props on each tile.
 * This component provides:
 *   - A coloured overlay on the map canvas (showOverlay)
 *   - A "TileData" tool (tool === 'tiledata') that paints / erases props
 *   - A sidebar panel with property selector, value input, and erase-mode toggle
 *   - Property group tabs (All / Collision / Navigation / Placement / Events / Doors)
 */
class TileDataEditor {
  /**
   * @param {object} state      - Shared editor state object
   * @param {object} callbacks  - { renderMap, pushUndo, setStatus }
   */
  constructor(state, callbacks) {
    this.state     = state;
    this.callbacks = callbacks;

    /** Whether the TileData overlay is rendered on the map. */
    this.showOverlay = false;

    /** Property key that will be painted onto tiles. */
    this.paintProp  = 'Passable';

    /** Value that will be assigned to paintProp. */
    this.paintValue = true;

    /** When true, clicking/dragging removes paintProp instead of setting it. */
    this.eraseMode  = false;

    /** Maximum characters shown in the tile label overlay. */
    this.MAX_LABEL_LENGTH = 5;

    /**
     * Pre-defined TileData property groups for the panel tabs.
     * props: null → show all KNOWN_PROPS.
     * groupColor: CSS color used for the map overlay when this group is active.
     */
    this.PROP_GROUPS = [
      { id: 'all',        name: 'All',        groupColor: null,                      props: null },
      { id: 'collision',  name: 'Collision',  groupColor: 'rgba(220,40,40,0.35)',    props: ['Passable','NPCBarrier','NoRender','CannotPass'] },
      { id: 'navigation', name: 'Navigation', groupColor: 'rgba(30,120,255,0.35)',   props: ['WaterTile','Friction','PathType','Layer'] },
      { id: 'placement',  name: 'Placement',  groupColor: 'rgba(80,160,80,0.35)',    props: ['Diggable','Tillable','Placeable','Shadow'] },
      { id: 'events',     name: 'Events',     groupColor: 'rgba(147,112,219,0.35)',  props: ['Action','TouchAction'] },
      { id: 'doors',      name: 'Doors',      groupColor: 'rgba(255,140,0,0.35)',    props: ['LockedDoor'] },
    ];

    /** Currently active property group id. */
    this.activeGroupId = 'all';

    /**
     * Known Stardew Valley TileData properties with:
     *   - color : semi-transparent RGBA for the overlay rectangle
     *   - defaultVal : value shown in the value input when this prop is chosen
     */
    this.KNOWN_PROPS = [
      { key: 'Passable',    defaultVal: true,  color: 'rgba(40,200,40,0.45)'    },
      { key: 'NPCBarrier',  defaultVal: true,  color: 'rgba(220,40,40,0.45)'    },
      { key: 'LockedDoor',  defaultVal: true,  color: 'rgba(255,140,0,0.45)'    },
      { key: 'WaterTile',   defaultVal: true,  color: 'rgba(30,120,255,0.45)'   },
      { key: 'NoRender',    defaultVal: true,  color: 'rgba(120,120,120,0.45)'  },
      { key: 'Diggable',    defaultVal: true,  color: 'rgba(139,69,19,0.45)'    },
      { key: 'Tillable',    defaultVal: true,  color: 'rgba(80,160,80,0.45)'    },
      { key: 'Placeable',   defaultVal: true,  color: 'rgba(160,80,160,0.45)'   },
      { key: 'Action',      defaultVal: '',    color: 'rgba(147,112,219,0.45)'  },
      { key: 'TouchAction', defaultVal: '',    color: 'rgba(255,105,180,0.45)'  },
      { key: 'Friction',    defaultVal: 0.5,   color: 'rgba(255,200,0,0.35)'    },
      { key: 'Shadow',      defaultVal: true,  color: 'rgba(100,100,150,0.45)'  },
      { key: 'PathType',    defaultVal: 0,     color: 'rgba(200,160,0,0.40)'    },
      { key: 'Layer',       defaultVal: 'Back',color: 'rgba(0,180,180,0.40)'    },
      { key: 'CannotPass',  defaultVal: true,  color: 'rgba(200,60,60,0.45)'    },
    ];

    /** Fast color lookup: key → CSS color */
    this._colorMap = Object.fromEntries(this.KNOWN_PROPS.map(p => [p.key, p.color]));

    // DOM references (set in buildPanel)
    this._propSel    = null;
    this._valIn      = null;
    this._tabsWrap   = null;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Returns the display color for a given TileData property name.
   * Falls back to a neutral yellow if the prop is not in the known list.
   * @param {string} propName
   * @returns {string}
   */
  getPropColor(propName) {
    return this._colorMap[propName] || 'rgba(255,200,0,0.35)';
  }

  /**
   * Returns the active PROP_GROUP object.
   */
  getActiveGroup() {
    return this.PROP_GROUPS.find(g => g.id === this.activeGroupId) || this.PROP_GROUPS[0];
  }

  /**
   * Returns the set of property keys that should be shown/painted for the
   * currently active group.  Returns null when "All" is active (no filter).
   */
  getActiveGroupProps() {
    const group = this.getActiveGroup();
    return group.props; // null = all
  }

  // ---------------------------------------------------------------------------
  // Map rendering
  // ---------------------------------------------------------------------------

  /**
   * Render semi-transparent TileData overlays for every tile in `layer` that
   * has at least one property relevant to the active group.
   * Called from renderMap() after all tile layers are drawn.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} layer
   */
  renderOverlay(ctx, layer) {
    if (!this.showOverlay) return;
    const tw = layer.tileWidth;
    const th = layer.tileHeight;
    const fontSize = Math.max(5, Math.min(th * 0.45, 9));

    const activeGroup   = this.getActiveGroup();
    const filterProps   = activeGroup.props;     // null = all
    const groupColor    = activeGroup.groupColor; // null = use per-prop color

    ctx.save();
    ctx.font           = `bold ${fontSize}px system-ui`;
    ctx.textAlign      = 'center';
    ctx.textBaseline   = 'middle';
    ctx.lineWidth      = 2;

    for (let ty = 0; ty < layer.layerHeight; ty++) {
      for (let tx = 0; tx < layer.layerWidth; tx++) {
        const tile = layer.tiles[ty * layer.layerWidth + tx];
        if (!tile || tile.isNull) continue;
        const props = tile.props;
        if (!props) continue;

        // Collect relevant keys (filtered by active group)
        let keys = Object.keys(props);
        if (filterProps) {
          keys = keys.filter(k => filterProps.includes(k));
        }
        if (keys.length === 0) continue;

        const maxBands = Math.min(keys.length, 3);
        const bandH    = th / maxBands;

        // Draw one coloured band per property (up to 3)
        keys.forEach((k, i) => {
          if (i >= maxBands) return;
          ctx.fillStyle = groupColor || this.getPropColor(k);
          ctx.fillRect(tx * tw, ty * th + i * bandH, tw, bandH);
        });

        // White label (with dark outline) for the primary property
        const label = keys[0].substring(0, this.MAX_LABEL_LENGTH);
        ctx.strokeStyle = 'rgba(0,0,0,0.65)';
        ctx.strokeText(label, tx * tw + tw / 2, ty * th + th / 2);
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.fillText(label,   tx * tw + tw / 2, ty * th + th / 2);
      }
    }

    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Painting / erasing
  // ---------------------------------------------------------------------------

  /**
   * Paint the selected TileData property onto the tile at map position (tx, ty).
   * Only works on non-null tiles (cannot create empty tiles from scratch).
   */
  paint(tx, ty, layer) {
    const tile = layer.tiles[ty * layer.layerWidth + tx];
    if (!tile || tile.isNull) return;
    tile.props = tile.props || {};
    tile.props[this.paintProp] = this.paintValue;
  }

  /**
   * Remove the selected TileData property from the tile at (tx, ty).
   */
  erase(tx, ty, layer) {
    const tile = layer.tiles[ty * layer.layerWidth + tx];
    if (!tile || tile.isNull || !tile.props) return;
    delete tile.props[this.paintProp];
  }

  // ---------------------------------------------------------------------------
  // Sidebar panel
  // ---------------------------------------------------------------------------

  /**
   * Build the TileData sidebar panel DOM element and return it.
   * Should be inserted once into the right-panel; no further calls needed.
   * @returns {HTMLElement}
   */
  buildPanel() {
    const wrap = document.createElement('div');
    wrap.id        = 'tiledata-panel';
    wrap.className = 'panel-section';

    // --- Header ---
    const header = document.createElement('div');
    header.className   = 'panel-header';
    header.textContent = 'TileData';
    wrap.appendChild(header);

    // --- Group tabs ---
    const tabsWrap = document.createElement('div');
    tabsWrap.className = 'tiledata-group-tabs';
    this._tabsWrap = tabsWrap;

    this.PROP_GROUPS.forEach(group => {
      const tab = document.createElement('button');
      tab.className   = 'tiledata-group-tab' + (group.id === this.activeGroupId ? ' active' : '');
      tab.textContent = group.name;
      tab.dataset.groupId = group.id;
      tab.addEventListener('click', () => {
        this.activeGroupId = group.id;
        // Update active tab styles
        tabsWrap.querySelectorAll('.tiledata-group-tab').forEach(t => {
          t.classList.toggle('active', t.dataset.groupId === group.id);
        });
        // Reset prop selector to the first prop of this group
        this._refreshPropSelect();
        this.callbacks.renderMap();
      });
      tabsWrap.appendChild(tab);
    });
    wrap.appendChild(tabsWrap);

    // --- Content ---
    const content = document.createElement('div');
    content.className = 'tiledata-content';

    // Property selector label
    content.appendChild(this._lbl('Paint Property:'));

    // Known-property <select>
    const propSel = document.createElement('select');
    propSel.id        = 'tiledata-prop-select';
    propSel.className = 'tiledata-select';
    this._propSel = propSel;

    this._buildPropOptions(propSel);

    // Value input (default = "true")
    const valIn = document.createElement('input');
    valIn.id        = 'tiledata-val-input';
    valIn.className = 'tiledata-input';
    valIn.value     = 'true';
    this._valIn = valIn;

    // Custom key input (hidden unless "custom" selected)
    const customWrap = document.createElement('div');
    customWrap.className       = 'tiledata-custom-row';
    customWrap.style.display   = 'none';
    const customIn = document.createElement('input');
    customIn.className   = 'tiledata-input';
    customIn.placeholder = 'Custom property key…';
    customIn.addEventListener('change', () => {
      const k = customIn.value.trim();
      if (k) this.paintProp = k;
    });
    customWrap.appendChild(customIn);

    propSel.addEventListener('change', () => {
      if (propSel.value === '__custom__') {
        customWrap.style.display = 'flex';
        return;
      }
      customWrap.style.display = 'none';
      this.paintProp = propSel.value;
      const def = this.KNOWN_PROPS.find(p => p.key === propSel.value);
      if (def) {
        this.paintValue = def.defaultVal;
        valIn.value     = String(def.defaultVal);
      }
    });

    content.appendChild(propSel);
    content.appendChild(customWrap);

    // Value input
    content.appendChild(this._lbl('Value:'));
    valIn.addEventListener('change', () => {
      this.paintValue = this._parseValue(valIn.value);
    });
    content.appendChild(valIn);

    // Erase-mode toggle
    const eraseLabel = document.createElement('label');
    eraseLabel.className = 'tiledata-checkbox-row';
    const eraseChk = document.createElement('input');
    eraseChk.type = 'checkbox';
    eraseChk.id   = 'tiledata-erase-mode';
    eraseChk.addEventListener('change', () => {
      this.eraseMode = eraseChk.checked;
    });
    eraseLabel.append(eraseChk, ' Erase mode');
    content.appendChild(eraseLabel);

    // Help text
    const help = document.createElement('div');
    help.className   = 'tiledata-help';
    help.textContent = 'Select a group tab, choose property & value, then use the TD✏ tool to paint tiles.';
    content.appendChild(help);

    wrap.appendChild(content);
    return wrap;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /** Populate or repopulate the property <select> based on the active group. */
  _buildPropOptions(sel) {
    sel.innerHTML = '';
    const filterProps = this.getActiveGroupProps(); // null = all

    const propsToShow = filterProps
      ? this.KNOWN_PROPS.filter(p => filterProps.includes(p.key))
      : this.KNOWN_PROPS;

    propsToShow.forEach(p => {
      const opt  = document.createElement('option');
      opt.value  = p.key;
      opt.textContent = p.key;
      sel.appendChild(opt);
    });

    // Separator + "custom" entry
    const sep = document.createElement('option');
    sep.disabled    = true;
    sep.textContent = '──────────';
    sel.appendChild(sep);

    const cust = document.createElement('option');
    cust.value       = '__custom__';
    cust.textContent = '(custom key…)';
    sel.appendChild(cust);

    // Set initial paintProp to the first visible option
    if (propsToShow.length > 0) {
      this.paintProp  = propsToShow[0].key;
      this.paintValue = propsToShow[0].defaultVal;
      sel.value = this.paintProp;
      if (this._valIn) this._valIn.value = String(this.paintValue);
    }
  }

  /** Refresh the prop select when the active group changes. */
  _refreshPropSelect() {
    if (!this._propSel) return;
    this._buildPropOptions(this._propSel);
  }

  _lbl(text) {
    const el       = document.createElement('div');
    el.className   = 'tiledata-label';
    el.textContent = text;
    return el;
  }

  _parseValue(str) {
    if (str === 'true'  || str === 'T') return true;
    if (str === 'false' || str === 'F') return false;
    const n = Number(str);
    if (!isNaN(n) && str.trim() !== '') return n;
    return str;
  }
}
