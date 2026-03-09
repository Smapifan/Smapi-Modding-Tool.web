#!/usr/bin/env node
/**
 * Stardew Valley Map Editor – Entry Point
 * Runs locally – no server, no backend.
 * Opens index.html directly in the default browser via file:// protocol.
 */

'use strict';

const path = require('path');
const fs   = require('fs');
const { execSync, spawn } = require('child_process');
const os   = require('os');

const ROOT      = __dirname;
const ADDON_PATH = path.join(ROOT, 'build', 'Release', 'tbin_addon.node');
const HTML_PATH  = path.join(ROOT, 'index.html');

// ─── Build native addon if not present ───────────────────────────────────────
function ensureAddonBuilt() {
    if (fs.existsSync(ADDON_PATH)) return;

    console.log('🔧  Native .tbin addon not found – building now …');
    console.log('    (requires node-gyp and a C++17 compiler)\n');

    // Install deps first if node_modules is missing
    if (!fs.existsSync(path.join(ROOT, 'node_modules'))) {
        console.log('📦  Installing npm dependencies …');
        execSync('npm install --ignore-scripts', { cwd: ROOT, stdio: 'inherit' });
    }

    try {
        execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });
        console.log('\n✅  Native addon compiled successfully!\n');
    } catch {
        console.warn('\n⚠️   Native addon build failed.');
        console.warn('    The editor will use the built-in JavaScript fallback for .tbin support.');
        console.warn('    For full native support install a C++17 compiler and run: npm run build\n');
    }
}

// ─── Open browser ─────────────────────────────────────────────────────────────
function openBrowser(url) {
    const platform = os.platform();
    const args     = [];
    let   cmd;

    if (platform === 'win32') {
        // Windows: use start command
        return spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    }
    if (platform === 'darwin') {
        cmd  = 'open';
        args.push(url);
    } else {
        // Linux / Android-Termux / others
        for (const browser of ['xdg-open', 'sensible-browser', 'gnome-open', 'firefox', 'chromium-browser', 'google-chrome']) {
            try {
                execSync(`which ${browser}`, { stdio: 'ignore' });
                cmd = browser;
                args.push(url);
                break;
            } catch { /* try next */ }
        }
        if (!cmd) {
            console.log(`\n📂  Open this file in your browser:\n    ${url}\n`);
            return;
        }
    }

    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
}

// ─── Main ─────────────────────────────────────────────────────────────────────
(function main() {
    ensureAddonBuilt();

    if (!fs.existsSync(HTML_PATH)) {
        console.error('❌  index.html not found at:', HTML_PATH);
        process.exit(1);
    }

    const fileUrl = 'file://' + HTML_PATH.replace(/\\/g, '/');
    console.log('🎮  Stardew Valley Map Editor v1.0');
    console.log('    Opening editor …');
    console.log('    URL:', fileUrl, '\n');

    openBrowser(fileUrl);
})();
