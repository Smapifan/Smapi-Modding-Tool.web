/**
 * AssetManager component – public entry point.
 *
 * Loads in order (each script exposes its class on window):
 *   1. AssetLibrary  – catalog + image loading
 *   2. AssetManager  – editor integration
 *
 * Usage (browser, after both scripts are loaded):
 *
 *   const library = new AssetLibrary();
 *   const manager = new AssetManager(library, state);
 *   await manager.init();
 *   const { loaded, missing } = await manager.autoLoadTilesheets(map.tilesheets);
 */

// Nothing to do here – both classes are already exported to window by their
// respective files. This file serves as documentation for the component.
