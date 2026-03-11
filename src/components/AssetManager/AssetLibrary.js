/**
 * AssetLibrary – loads and indexes the asset catalog from assets/library.json.
 *
 * Provides:
 *   - Tilesheet discovery by ID / alias / filename fuzzy-match
 *   - Automatic image loading with an in-memory cache
 *   - Map listing and binary map data loading
 *
 * Requires the editor to be served over HTTP (not file://).
 * When running via `node main.js` the built-in HTTP server satisfies this.
 */

'use strict';

class AssetLibrary {
    /**
     * @param {string} [baseUrl=''] Base URL used when resolving asset paths.
     *   Defaults to '' (same origin), which works correctly when the editor
     *   is served by the built-in HTTP server in main.js.
     */
    constructor(baseUrl = '') {
        this.baseUrl  = baseUrl.replace(/\/$/, '');
        this.library  = null;
        this._ready   = false;
        this._imageCache = new Map(); // tsId -> HTMLImageElement
        this._loadPromise = null;
    }

    // ─── Initialisation ─────────────────────────────────────────────────────

    /**
     * Load library.json once; subsequent calls return the cached promise.
     * Safe to call multiple times.
     * @returns {Promise<boolean>} true if library loaded successfully.
     */
    load() {
        if (this._loadPromise) return this._loadPromise;

        this._loadPromise = fetch(`${this.baseUrl}/assets/library.json`)
            .then(res => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            })
            .then(lib => {
                this.library = lib;
                this._ready  = true;
                console.info(`[AssetLibrary] Loaded: ${this.tilesheets.length} tilesheet(s), ${this.maps.length} map(s)`);
                return true;
            })
            .catch(err => {
                console.warn('[AssetLibrary] Could not load library.json:', err.message);
                this.library = { tilesheets: [], maps: [], objects: [] };
                this._ready  = false;
                return false;
            });

        return this._loadPromise;
    }

    // ─── Accessors ───────────────────────────────────────────────────────────

    /** @returns {Array} All tilesheet entries from the library catalog. */
    get tilesheets() { return (this.library && this.library.tilesheets) || []; }

    /** @returns {Array} All map entries from the library catalog. */
    get maps()       { return (this.library && this.library.maps)       || []; }

    // ─── Tilesheet resolution ────────────────────────────────────────────────

    /**
     * Find the best-matching library entry for a given tilesheet ID.
     *
     * Matching order (first match wins):
     *   1. Exact id match
     *   2. Exact alias match
     *   3. Basename of the library path matches tsId (case-insensitive)
     *   4. tsId is a substring of a library id/alias, or vice-versa
     *
     * @param {string} tsId Tilesheet identifier from the .tbin map.
     * @returns {{ id, path, tileWidth, tileHeight, aliases, ... } | null}
     */
    findTilesheetEntry(tsId) {
        if (!tsId || !this.tilesheets.length) return null;

        const lower = tsId.toLowerCase();
        const base  = lower.split('/').pop().replace(/\.png$/i, '');

        // 1 & 2: exact id / alias match
        for (const entry of this.tilesheets) {
            if (entry.id === tsId) return entry;
            if (Array.isArray(entry.aliases) && entry.aliases.includes(tsId)) return entry;
        }

        // 3: basename of library path matches tsId
        for (const entry of this.tilesheets) {
            const entryBase = entry.path.split('/').pop().replace(/\.png$/i, '').toLowerCase();
            if (entryBase === base) return entry;
        }

        // 4: substring / partial match (case-insensitive)
        for (const entry of this.tilesheets) {
            const idLower = entry.id.toLowerCase();
            if (idLower.includes(base) || base.includes(idLower)) return entry;
            if (Array.isArray(entry.aliases)) {
                for (const alias of entry.aliases) {
                    const al = alias.toLowerCase();
                    if (al.includes(base) || base.includes(al)) return entry;
                }
            }
        }

        return null;
    }

    // ─── Image loading ───────────────────────────────────────────────────────

    /**
     * Try to load the image for a tilesheet from the asset library.
     *
     * @param {string} tsId Tilesheet ID.
     * @returns {Promise<HTMLImageElement | null>} Loaded image, or null on failure.
     */
    async loadImage(tsId) {
        // Return cached image immediately
        if (this._imageCache.has(tsId)) return this._imageCache.get(tsId);

        const entry = this.findTilesheetEntry(tsId);
        if (!entry) return null;

        const url = `${this.baseUrl}/${entry.path}`;
        return new Promise(resolve => {
            const img = new Image();
            img.onload  = () => { this._imageCache.set(tsId, img); resolve(img); };
            img.onerror = () => resolve(null);
            img.src     = url;
        });
    }

    /**
     * Store an externally-loaded image in the cache (e.g. from drag-and-drop).
     * Custom images always override library images.
     * @param {string} tsId
     * @param {HTMLImageElement} img
     */
    cacheImage(tsId, img) {
        this._imageCache.set(tsId, img);
    }

    /**
     * Remove a cached image (e.g. when a tilesheet is deleted).
     * @param {string} tsId
     */
    evictImage(tsId) {
        this._imageCache.delete(tsId);
    }

    // ─── Map loading ─────────────────────────────────────────────────────────

    /**
     * Fetch the binary data for a named map from the asset library.
     * @param {string} mapId Map ID as listed in library.json.
     * @returns {Promise<ArrayBuffer | null>}
     */
    async loadMapData(mapId) {
        if (!this.library) return null;
        const entry = this.maps.find(m => m.id === mapId);
        if (!entry) return null;

        try {
            const res = await fetch(`${this.baseUrl}/${entry.path}`);
            if (!res.ok) return null;
            return await res.arrayBuffer();
        } catch {
            return null;
        }
    }

    // ─── Suggestions ─────────────────────────────────────────────────────────

    /**
     * Return a list of library tilesheet suggestions for a missing tilesheet ID.
     * Used for the "missing tilesheet" dialog to hint users at what to copy.
     * @param {string} tsId
     * @returns {Array<{ id, path, description }>}
     */
    getSuggestions(tsId) {
        if (!tsId) return this.tilesheets.slice(0, 3);
        const entry = this.findTilesheetEntry(tsId);
        if (entry) return [entry];

        // Return all entries as fallback suggestions
        return this.tilesheets.slice(0, 5);
    }
}

// ─── Export ──────────────────────────────────────────────────────────────────

if (typeof window !== 'undefined') {
    window.AssetLibrary = AssetLibrary;
}
