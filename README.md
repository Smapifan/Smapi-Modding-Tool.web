# Stardew Valley Map Editor v1.0

A production-ready, browser-based map editor for Stardew Valley `.tbin` files with
native C++ plugin support via Node.js.

---

## ✨ Features

### Map Editing
- 🗺 **Full .tbin support** – load, edit and save Stardew Valley maps with 100% format fidelity
- 🖌 **Canvas editor** – paint, erase, flood-fill, eyedropper tools
- 📋 **Layer management** – Back / Buildings / Front / custom layers, reorder, show/hide
- 🖼 **Tilesheet selector** – import PNG/JPG tilesets, pick tiles visually

### Stardew Valley Specific
- 🌸 **Season selector** – Spring / Summer / Fall / Winter with visual feedback
- 🛡 **Collision overlay** – visualise Passable, WaterTile, NoRender properties per tile
- 🔧 **Tile Inspector** – click any tile (Select tool) to view/edit all tile properties
- 🗺 **Map Properties** – edit name, description, Music, Ambience and season override
- ▶ **Animation preview** – animated tiles cycle through frames in real time
- 📝 **SDV property autocomplete** – Passable, WaterTile, NPCBarrier, Action, …

### File Operations
- 📁 **Drag & drop** – drop `.tbin` or `.json` files directly onto the editor
- 💾 **Save .tbin** – direct browser download, indices preserved
- 📤 **Export JSON** – human-readable map inspection
- 🖼 **Load tilesheet image** – assign images to tilesheets loaded from `.tbin` files
- ⚠ **Missing tilesheet handling** – red-X placeholder, load-image button, NO data loss

### Interface
- ↩ **Undo / Redo** – full history (up to 100 steps)
- 🔍 **Zoom & pan** – mouse wheel zoom, middle-click pan, pinch-to-zoom on mobile
- 📱 **Touch support** – full touchstart/move/end + pinch-to-zoom for mobile/tablet
- ⌨ **Keyboard shortcuts** – all common operations
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

## 🎮 Stardew Valley Features

### Season Selector
The toolbar shows four season buttons (🌸 ☀️ 🍂 ❄️). Selecting a season:
- Updates the `season` map property (if already present)
- Provides visual feedback in the toolbar
- Can be used to organise seasonal tile work

### Collision Overlay (🛡)
Toggle the collision overlay to visualise tile passability:
- 🔴 **Red** – tile has `Passable: false` or is on Buildings/Front layer
- 🟢 **Green** – tile has `Passable: true`
- 🔵 **Blue** – tile has `WaterTile: true`
- ⬜ **Gray** – tile has `NoRender: true`

### Tile Inspector
Select the **Select** tool (S) and click any tile to inspect it in the right panel:
- View tile type (static / animated), tilesheet, tile index, blend mode
- View and edit all tile properties (`Passable`, `WaterTile`, `Action`, etc.)
- Add / delete tile properties with type preservation (bool/int/float/string)
- Animated tile frames listed with tilesheet and index per frame

### Map Properties
Click **Map Props** in the menu bar to edit:
- Map ID and description
- `Music` property (e.g. `MarlonsTheme`)
- `Ambience` property (e.g. `spring_day_ambient`)
- Season override property

### Missing Tilesheet Images
When a `.tbin` file references tilesheet images by path (e.g. `Maps/spring_outdoors`),
the editor cannot access them directly. Instead:
- A red-X placeholder is drawn for all tiles on that tilesheet
- A warning notice appears in the tilesheet panel
- **Tile indices are preserved** – no data is lost
- Click the 🖼 button or the **Load image** notice to assign the actual PNG/JPG file

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
| `S` | Select tool (click tile to inspect) |
| `P` | Paint tool |
| `E` | Erase tool |
| `F` | Flood fill |
| `I` | Eyedropper |
| `G` | Toggle grid |
| `C` | (toolbar) Collision overlay |
| `+` / `-` | Zoom in / out |
| `0` | Fit to window |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` | Redo |
| `Ctrl+S` | Save |
| `Ctrl+O` | Open |
| `Ctrl+N` | New map |

---

## 📂 Example Files

The `examples/` directory contains ready-to-open `.tbin` maps:

| File | Description |
|---|---|
| `examples/Farm.tbin` | 20×15 farm map, summer season, Music/Ambience properties |
| `examples/Mine.tbin` | 10×10 mine level with wall tiles that have `Passable: false` and water tiles. Try the Collision Overlay! |

Open them with **File → Open** or drag & drop onto the editor.

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
├── examples/
│   ├── Farm.tbin           Sample farm map
│   └── Mine.tbin           Sample mine map (collision demo)
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
