#!/usr/bin/env node
/**
 * Stardew Valley Map Editor – Entry Point
 * Starts a lightweight HTTP server so assets (tilesheets, maps) can be
 * fetched by the browser, then opens the editor in the default browser.
 */

'use strict';

const path = require('path');
const fs   = require('fs');
const http = require('http');
const { execSync, spawn } = require('child_process');
const os   = require('os');

const ROOT      = __dirname;
const ADDON_PATH = path.join(ROOT, 'build', 'Release', 'tbin_addon.node');
const HTML_PATH  = path.join(ROOT, 'index.html');
const DEFAULT_PORT = 3580;

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

// ─── Static file server ──────────────────────────────────────────────────────
const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.js':   'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif':  'image/gif',
    '.svg':  'image/svg+xml',
    '.tbin': 'application/octet-stream',
    '.ico':  'image/x-icon',
};

function startServer(port, callback) {
    const server = http.createServer((req, res) => {
        let urlPath = req.url.split('?')[0];
        if (urlPath === '/') urlPath = '/index.html';

        // Prevent directory traversal
        const filePath = path.normalize(path.join(ROOT, urlPath));
        if (!filePath.startsWith(ROOT)) {
            res.writeHead(403); res.end('Forbidden'); return;
        }

        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('Not found: ' + urlPath);
                return;
            }
            const ext         = path.extname(filePath).toLowerCase();
            const contentType = MIME_TYPES[ext] || 'application/octet-stream';
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(data);
        });
    });

    server.on('error', err => {
        if (err.code === 'EADDRINUSE') {
            // Port busy – fall back to next port
            startServer(port + 1, callback);
        } else {
            throw err;
        }
    });

    server.listen(port, '127.0.0.1', () => {
        callback(`http://127.0.0.1:${port}`);
    });
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
            console.log(`\n📂  Open this URL in your browser:\n    ${url}\n`);
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

    startServer(DEFAULT_PORT, url => {
        console.log('🎮  Stardew Valley Map Editor v1.0');
        console.log('    Opening editor …');
        console.log('    URL:', url, '\n');
        console.log('    Asset library served from ./assets/');
        console.log('    Place tilesheet images in assets/tilesheets/\n');
        openBrowser(url);
    });
})();
