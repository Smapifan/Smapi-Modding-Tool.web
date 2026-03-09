#!/usr/bin/env node
/**
 * Stardew Valley Map Editor – CLI Tool
 *
 * Usage:
 *   node cli.js load   <input.tbin>
 *   node cli.js save   <output.tbin> <map.json>
 *   node cli.js convert <input.tbin> <output.json>
 *   node cli.js validate <file.tbin>
 *   node cli.js info   <input.tbin>
 *   node cli.js batch  <inputDir> <outputDir>  (converts all .tbin → JSON)
 */

'use strict';

const path    = require('path');
const fs      = require('fs');
const os      = require('os');

const ROOT = path.join(__dirname);

// ─── Load native addon (with JS fallback) ────────────────────────────────────
let addon = null;
const ADDON_PATH = path.join(ROOT, 'build', 'Release', 'tbin_addon.node');

try {
    addon = require(ADDON_PATH);
    console.error('ℹ️   Using native C++ .tbin addon.');
} catch {
    // Fallback: pure JS tbin reader/writer
    console.error('ℹ️   Native addon not found – using JS fallback.\n    Run "npm run build" for native support.');
    addon = require('./src/tbin-js-fallback.js');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function loadAndPrint(filePath) {
    const absPath = path.resolve(filePath);
    console.log(`📂  Loading: ${absPath}`);
    const map = addon.loadMap(absPath);
    console.log(JSON.stringify(map, null, 2));
}

function saveMap(outputPath, jsonPath) {
    const absOut  = path.resolve(outputPath);
    const absJson = path.resolve(jsonPath);
    const data    = JSON.parse(fs.readFileSync(absJson, 'utf8'));
    addon.saveMap(absOut, data);
    console.log(`✅  Saved: ${absOut}`);
}

function convertToJson(inputPath, outputPath) {
    const absIn  = path.resolve(inputPath);
    const absOut = path.resolve(outputPath);
    const map    = addon.loadMap(absIn);
    fs.writeFileSync(absOut, JSON.stringify(map, null, 2), 'utf8');
    console.log(`✅  Converted: ${absIn} → ${absOut}`);
}

function validateFile(filePath) {
    const absPath = path.resolve(filePath);
    const valid   = addon.validateMap(absPath);
    console.log(valid
        ? `✅  ${absPath} is a valid .tbin file.`
        : `❌  ${absPath} is NOT a valid .tbin file.`
    );
    process.exitCode = valid ? 0 : 1;
}

function printInfo(filePath) {
    const absPath = path.resolve(filePath);
    const map     = addon.loadMap(absPath);
    console.log(`\n📌  Map Info: ${absPath}`);
    console.log(`    ID:         ${map.id}`);
    console.log(`    Desc:       ${map.desc}`);
    console.log(`    Tilesheets: ${map.tilesheets.length}`);
    console.log(`    Layers:     ${map.layers.length}`);
    map.layers.forEach(l => {
        console.log(`      • ${l.id}  (${l.layerWidth}×${l.layerHeight}, tileSize=${l.tileWidth}×${l.tileHeight}, visible=${l.visible})`);
    });
}

function batchConvert(inputDir, outputDir) {
    const absIn  = path.resolve(inputDir);
    const absOut = path.resolve(outputDir);
    fs.mkdirSync(absOut, { recursive: true });

    const files = fs.readdirSync(absIn).filter(f => f.endsWith('.tbin'));
    if (files.length === 0) {
        console.log(`⚠️   No .tbin files found in ${absIn}`);
        return;
    }
    files.forEach(file => {
        const inFile  = path.join(absIn, file);
        const outFile = path.join(absOut, file.replace('.tbin', '.json'));
        try {
            convertToJson(inFile, outFile);
        } catch (e) {
            console.error(`❌  Failed ${file}: ${e.message}`);
        }
    });
    console.log(`\n✅  Batch complete: ${files.length} files processed.`);
}

function printHelp() {
    console.log(`
Stardew Valley Map Editor CLI v1.0
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Usage:
  node cli.js load     <input.tbin>
  node cli.js save     <output.tbin> <map.json>
  node cli.js convert  <input.tbin>  <output.json>
  node cli.js validate <file.tbin>
  node cli.js info     <input.tbin>
  node cli.js batch    <inputDir>    <outputDir>
  node cli.js version
`);
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────
const [,, cmd, ...args] = process.argv;

try {
    switch (cmd) {
        case 'load':
            if (!args[0]) { console.error('Usage: node cli.js load <file.tbin>'); process.exit(1); }
            loadAndPrint(args[0]);
            break;
        case 'save':
            if (!args[1]) { console.error('Usage: node cli.js save <output.tbin> <map.json>'); process.exit(1); }
            saveMap(args[0], args[1]);
            break;
        case 'convert':
            if (!args[1]) { console.error('Usage: node cli.js convert <input.tbin> <output.json>'); process.exit(1); }
            convertToJson(args[0], args[1]);
            break;
        case 'validate':
            if (!args[0]) { console.error('Usage: node cli.js validate <file.tbin>'); process.exit(1); }
            validateFile(args[0]);
            break;
        case 'info':
            if (!args[0]) { console.error('Usage: node cli.js info <file.tbin>'); process.exit(1); }
            printInfo(args[0]);
            break;
        case 'batch':
            if (!args[1]) { console.error('Usage: node cli.js batch <inputDir> <outputDir>'); process.exit(1); }
            batchConvert(args[0], args[1]);
            break;
        case 'version':
            console.log(`tbin-addon v${addon.getVersion ? addon.getVersion() : '1.0.0'}`);
            break;
        default:
            printHelp();
            break;
    }
} catch (e) {
    console.error(`\n❌  Error: ${e.message}\n`);
    process.exit(1);
}
