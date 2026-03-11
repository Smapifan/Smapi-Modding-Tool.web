/**
 * AssetManager – bridges the editor state with the AssetLibrary.
 *
 * Responsibilities:
 *   - Initialise the AssetLibrary on startup
 *   - Auto-load tilesheet images for all tilesheets in a map
 *   - Provide the fallback-chain:  custom image  →  library image  →  missing
 *   - Update the editor's tileImages / tileMissing state after resolution
 *   - Enrich the missing-tilesheet dialog with library suggestions
 */

'use strict';

class AssetManager {
    /**
     * @param {AssetLibrary} library  An AssetLibrary instance (must be loaded).
     * @param {object}       state    The shared editor `state` object.
     */
    constructor(library, state) {
        this.library = library;
        this.state   = state;
        this._ready  = false;
    }

    // ─── Initialisation ─────────────────────────────────────────────────────

    /**
     * Load the asset library and prepare the manager.
     * Safe to call multiple times; subsequent calls return the cached promise.
     * @returns {Promise<boolean>} true if library loaded successfully.
     */
    async init() {
        const ok = await this.library.load();
        this._ready = ok;
        return ok;
    }

    // ─── Auto-load tilesheets ────────────────────────────────────────────────

    /**
     * For every tilesheet in `tilesheets`, attempt to resolve its image:
     *   1. Already in state.tileImages  → nothing to do
     *   2. Found in AssetLibrary        → load and store in state.tileImages
     *   3. Neither                      → mark as missing in state.tileMissing
     *
     * Runs all fetches in parallel for fast startup.
     *
     * @param {Array<{ id: string }>} tilesheets
     * @returns {Promise<{ loaded: string[], missing: string[] }>}
     *   Lists of tilesheet IDs that were loaded vs. still missing.
     */
    async autoLoadTilesheets(tilesheets) {
        const loaded  = [];
        const missing = [];

        const tasks = tilesheets.map(async ts => {
            const tsId = ts.id;

            // 1. Already loaded (custom image or from a previous run)
            if (this.state.tileImages[tsId] && this.state.tileImages[tsId].complete) {
                delete this.state.tileMissing[tsId];
                loaded.push(tsId);
                return;
            }

            // 2. Try the asset library
            const img = await this.library.loadImage(tsId);
            if (img) {
                this.state.tileImages[tsId] = img;
                // Update sheet dimensions from loaded image
                const tsMeta = this.state.map && this.state.map.tilesheets.find(t => t.id === tsId);
                if (tsMeta) {
                    tsMeta.sheetWidth  = img.naturalWidth;
                    tsMeta.sheetHeight = img.naturalHeight;
                }
                delete this.state.tileMissing[tsId];
                loaded.push(tsId);
            } else {
                // 3. Still missing
                this.state.tileMissing[tsId] = true;
                missing.push(tsId);
            }
        });

        await Promise.all(tasks);
        return { loaded, missing };
    }

    // ─── Missing-tilesheet dialog enrichment ────────────────────────────────

    /**
     * Build a user-friendly message for a missing tilesheet that includes
     * library suggestions (if any).
     *
     * @param {{ id: string, imagePath?: string }} ts  Tilesheet metadata.
     * @returns {string}
     */
    buildMissingMessage(ts) {
        const expected = ts.imagePath || ts.id;
        let msg = `Tilesheet "${ts.id}" expects image at: ${expected}. Please select the image file to load.`;

        const suggestions = this.library.getSuggestions(ts.id);
        if (suggestions.length > 0) {
            const entry = suggestions[0];
            msg += `\n\nHint: copy the game image to assets/tilesheets/${entry.path.split('/').pop()} for auto-loading.`;
        }

        return msg;
    }

    /**
     * Store a custom (user-loaded) image in both the state and the library cache.
     * Custom images override library images.
     *
     * @param {string}           tsId
     * @param {HTMLImageElement} img
     */
    storeCustomImage(tsId, img) {
        this.state.tileImages[tsId] = img;
        this.library.cacheImage(tsId, img);
        delete this.state.tileMissing[tsId];
    }

    /**
     * Remove all cached data for a tilesheet (called when a tilesheet is deleted).
     * @param {string} tsId
     */
    evict(tsId) {
        delete this.state.tileImages[tsId];
        delete this.state.tileMissing[tsId];
        this.library.evictImage(tsId);
    }
}

// ─── Export ──────────────────────────────────────────────────────────────────

if (typeof window !== 'undefined') {
    window.AssetManager = AssetManager;
}
