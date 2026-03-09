# Stardew Valley Map Editor v1.0

A production-ready, browser-based map editor for Stardew Valley `.tbin` files with
native C++ plugin support via Node.js.

---

## ✨ Features

- 🗺 **Full .tbin support** – load, edit and save Stardew Valley maps
- 🖌 **Canvas editor** – paint, erase, flood-fill, eyedropper tools
- 📋 **Layer management** – create, delete, reorder, show/hide layers
- 🖼 **Tilesheet selector** – import PNG/JPG tilesets, pick tiles visually
- 🔧 **Property editor** – per-layer custom properties
- ↩ **Undo / Redo** – full history (up to 100 steps)
- 🔍 **Zoom & pan** – mouse wheel zoom, middle-click pan
- 📁 **Drag & drop** – drop a `.tbin` or `.json` file directly into the editor
- 💻 **No backend** – runs entirely in the browser via `file://`
- ⚙️ **Native C++ addon** – optional high-performance .tbin I/O via `node-gyp`

---

## 🚀 Quick Start

### Option A – Just open in browser (no build required)

```bash
# Clone the repo, then open index.html directly:
open index.html          # macOS
xdg-open index.html      # Linux
start index.html         # Windows
```

### Option B – Use Node.js launcher (recommended)

```bash
npm install
node main.js             # opens the editor in your default browser
```

### Option C – Build native C++ addon (best performance)

Requires: **Node.js ≥ 18**, **node-gyp**, and a **C++17 compiler**
(GCC ≥ 7, Clang ≥ 5, or MSVC 2017+).

```bash
npm install
npm run build            # compiles for your current platform
node main.js
```

---

## 🖥 Platform Support

| Platform | Status | Notes |
|---|---|---|
| Windows 10/11 (x64, x86) | ✅ | MSVC / MinGW |
| macOS 11+ (Intel, Apple Silicon) | ✅ | Xcode CLT required |
| Linux (Debian/Ubuntu/Fedora, x64, ARM) | ✅ | `build-essential` required |
| Android (Termux) | ✅ | `pkg install nodejs clang make python` |
| iOS | ⚠️ | Browser-only mode (no native addon) |

---

## 💻 CLI Tool

```bash
node cli.js load     <file.tbin>                 # print map as JSON
node cli.js save     <output.tbin> <map.json>    # save JSON → .tbin
node cli.js convert  <input.tbin>  <output.json> # convert .tbin → JSON
node cli.js validate <file.tbin>                 # check magic bytes
node cli.js info     <file.tbin>                 # print map summary
node cli.js batch    <inputDir>   <outputDir>    # convert all .tbin files
node cli.js version                              # print addon version
```

---

## ⌨️ Keyboard Shortcuts

| Key | Action |
|---|---|
| `S` | Select tool |
| `P` | Paint tool |
| `E` | Erase tool |
| `F` | Flood fill |
| `I` | Eyedropper |
| `G` | Toggle grid |
| `+` / `-` | Zoom in / out |
| `0` | Fit to window |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` | Redo |
| `Ctrl+S` | Save |
| `Ctrl+O` | Open |
| `Ctrl+N` | New map |

---

## 🏗 Project Structure

```
├── src/
│   ├── plugins/tbin/       Original Tiled C++ .tbin plugin (1:1 copy)
│   │   ├── tbin/           Core C++ tbin library (Map, Layer, Tile, …)
│   │   ├── tbinmapformat.* Qt-based Tiled format wrapper
│   │   └── tbinplugin.*    Qt-based Tiled plugin entry
│   ├── native-addon.cc     Node.js N-API bridge (C++ ↔ JS)
│   ├── tbin_map_wrapper.cc Qt-compat wrapper for standalone compilation
│   ├── qt_stubs/QDebug     Stub header (no Qt required)
│   ├── tbin-js-fallback.js Pure JS .tbin reader/writer (browser fallback)
│   └── qt_compat.h         Qt macro compatibility shim
├── binding.gyp             node-gyp build config
├── package.json
├── main.js                 Entry point – opens browser
├── cli.js                  Command-line tool
├── index.html              Web UI
├── editor.js               Frontend canvas editor
├── style.css               Dark-theme CSS
└── README.md
```

---

## 🔧 Dependencies

| Package | Purpose |
|---|---|
| `node-addon-api` | N-API C++ bindings |
| `open` | Cross-platform browser opener |

---

## 📄 License

- Editor code: MIT
- Tiled plugin (`src/plugins/tbin/`): GPL-2.0 (Casey Warrington)
- tbin C++ library (`src/plugins/tbin/tbin/`): MIT (Casey Warrington)