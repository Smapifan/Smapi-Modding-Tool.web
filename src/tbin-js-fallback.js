/**
 * Pure JavaScript .tbin reader/writer – fallback when native addon is unavailable.
 *
 * Binary format (tBIN 1.0) documented from Tiled's tbin/Map.cpp:
 *   Header: "tBIN10" (6 bytes)
 *   Map: id(str) desc(str) props layerCount(i32) tilesheetCount(i32) ...
 *
 * Property types: 0=Bool(u8), 1=Integer(i32), 2=Float(f32), 3=String
 *
 * Layer tile markers (per row, per column):
 *   'N' + i32  – skip N null tiles
 *   'T' + str  – set current tilesheet
 *   'S'        – static tile: tileIndex(i32) + blendMode(u8) + props
 *   'A'        – animated tile: frameInterval(i32) + frameCount(i32) +
 *                  { 'T'+str | 'S'+[tileIndex(i32)+blendMode(u8)] }* + props
 */

'use strict';

const fs = require('fs');

// ─── Binary reader ────────────────────────────────────────────────────────────
class Br {
    constructor(buf) { this.b = buf; this.p = 0; }
    u8()    { return this.b.readUInt8(this.p++); }
    i32()   { const v = this.b.readInt32LE(this.p); this.p += 4; return v; }
    f32()   { const v = this.b.readFloatLE(this.p); this.p += 4; return v; }
    str()   { const n = this.i32(); const s = this.b.toString('utf8', this.p, this.p + n); this.p += n; return s; }
    v2()    { return { x: this.i32(), y: this.i32() }; }
}

// ─── Binary writer ────────────────────────────────────────────────────────────
class Bw {
    constructor() { this.cs = []; }
    u8(v)   { const b = Buffer.alloc(1); b.writeUInt8(v); this.cs.push(b); }
    i32(v)  { const b = Buffer.alloc(4); b.writeInt32LE(v); this.cs.push(b); }
    f32(v)  { const b = Buffer.alloc(4); b.writeFloatLE(v); this.cs.push(b); }
    str(s)  { const e = Buffer.from(s, 'utf8'); this.i32(e.length); this.cs.push(e); }
    v2(v)   { this.i32(v.x); this.i32(v.y); }
    raw(b)  { this.cs.push(b); }
    buf()   { return Buffer.concat(this.cs); }
}

// ─── Properties ───────────────────────────────────────────────────────────────
// Property type byte values (from PropertyValue.hpp enum):
//   Bool=0  Integer=1  Float=2  String=3

function readProps(r) {
    const n = r.i32(), o = {};
    for (let i = 0; i < n; i++) {
        const k = r.str(), t = r.u8();
        if      (t === 0) o[k] = r.u8() > 0;
        else if (t === 1) o[k] = r.i32();
        else if (t === 2) o[k] = r.f32();
        else if (t === 3) o[k] = r.str();
        else throw new Error(`Unknown property type ${t}`);
    }
    return o;
}

function writeProps(w, props) {
    const ks = Object.keys(props || {});
    w.i32(ks.length);
    for (const k of ks) {
        w.str(k);
        const v = props[k];
        if (typeof v === 'boolean') { w.u8(0); w.u8(v ? 1 : 0); }
        else if (Number.isInteger(v)) { w.u8(1); w.i32(v); }
        else if (typeof v === 'number') { w.u8(2); w.f32(v); }
        else { w.u8(3); w.str(String(v)); }
    }
}

// ─── Tilesheet ────────────────────────────────────────────────────────────────
function readTilesheet(r) {
    const ts = {};
    ts.id          = r.str();
    ts.desc        = r.str();
    ts.imagePath   = r.str();
    const sh = r.v2(); ts.sheetWidth = sh.x; ts.sheetHeight = sh.y;
    const tl = r.v2(); ts.tileWidth  = tl.x; ts.tileHeight  = tl.y;
    r.v2(); // margin  (discard)
    r.v2(); // spacing (discard)
    ts.props = readProps(r);
    return ts;
}

function writeTilesheet(w, ts) {
    w.str(ts.id        || '');
    w.str(ts.desc      || '');
    w.str(ts.imagePath || '');
    w.v2({ x: ts.sheetWidth  || 0,  y: ts.sheetHeight || 0  });
    w.v2({ x: ts.tileWidth   || 16, y: ts.tileHeight  || 16 });
    w.v2({ x: 0, y: 0 }); // margin
    w.v2({ x: 0, y: 0 }); // spacing
    writeProps(w, ts.props);
}

// ─── Layer ────────────────────────────────────────────────────────────────────
// Tile object shape (JS):
//   { isNull: true }
//   { isNull: false, isAnimated: false, staticTilesheet: str, staticIndex: i32, blendMode: u8, props: {} }
//   { isNull: false, isAnimated: true,  frameInterval: i32,
//     frames: [{tilesheet:str, tileIndex:i32}], props: {} }

function readLayer(r) {
    const layer = {};
    layer.id      = r.str();
    layer.visible = r.u8() > 0;
    layer.desc    = r.str();
    const ls = r.v2(); layer.layerWidth  = ls.x; layer.layerHeight = ls.y;
    const ts = r.v2(); layer.tileWidth   = ts.x; layer.tileHeight  = ts.y;
    layer.props = readProps(r);

    const total = layer.layerWidth * layer.layerHeight;
    layer.tiles = new Array(total).fill(null).map(() => ({ isNull: true }));
    let currTs = '';

    for (let iy = 0; iy < layer.layerHeight; iy++) {
        let ix = 0;
        while (ix < layer.layerWidth) {
            const c = r.u8();
            if (c === 0x4E) { // 'N' – null run
                ix += r.i32();
            } else if (c === 0x54) { // 'T' – tilesheet
                currTs = r.str();
            } else if (c === 0x53) { // 'S' – static tile
                const tile = { isNull: false, isAnimated: false, staticTilesheet: currTs };
                tile.staticIndex = r.i32();
                tile.blendMode   = r.u8();
                tile.props       = readProps(r);
                layer.tiles[ix + iy * layer.layerWidth] = tile;
                ix++;
            } else if (c === 0x41) { // 'A' – animated tile
                const tile = { isNull: false, isAnimated: true, frames: [] };
                tile.frameInterval = r.i32();
                const fc           = r.i32();
                let   frameTs      = currTs;
                let   read         = 0;
                while (read < fc) {
                    const fc2 = r.u8();
                    if (fc2 === 0x54) { // 'T'
                        frameTs = r.str();
                    } else if (fc2 === 0x53) { // 'S'
                        const fi   = r.i32();
                        r.u8(); // blendMode (not stored per-frame in our JS repr)
                        readProps(r); // frame props (discarded in our JS repr)
                        tile.frames.push({ tilesheet: frameTs, tileIndex: fi });
                        read++;
                    } else {
                        throw new Error(`Bad animated frame marker: 0x${fc2.toString(16)}`);
                    }
                }
                tile.props = readProps(r);
                layer.tiles[ix + iy * layer.layerWidth] = tile;
                ix++;
            } else {
                throw new Error(`Bad tile marker: 0x${c.toString(16)} at [${ix},${iy}]`);
            }
        }
    }
    return layer;
}

function writeLayer(w, layer) {
    w.str(layer.id    || '');
    w.u8(layer.visible !== false ? 1 : 0);
    w.str(layer.desc  || '');
    w.v2({ x: layer.layerWidth  || 0,  y: layer.layerHeight || 0  });
    w.v2({ x: layer.tileWidth   || 16, y: layer.tileHeight  || 16 });
    writeProps(w, layer.props);

    let currTs = '';
    const tiles = layer.tiles || [];

    for (let iy = 0; iy < (layer.layerHeight || 0); iy++) {
        let nulls = 0;
        for (let ix = 0; ix < (layer.layerWidth || 0); ix++) {
            const tile = tiles[ix + iy * layer.layerWidth];
            if (!tile || tile.isNull) { nulls++; continue; }

            if (nulls > 0) { w.u8(0x4E); w.i32(nulls); nulls = 0; } // 'N'

            // Determine tilesheet for this tile
            const ts = tile.isAnimated
                ? (tile.frames && tile.frames[0] ? tile.frames[0].tilesheet : '')
                : (tile.staticTilesheet || '');

            if (ts !== currTs) { w.u8(0x54); w.str(ts); currTs = ts; } // 'T'

            if (!tile.isAnimated) {
                w.u8(0x53); // 'S'
                w.i32(tile.staticIndex !== undefined ? tile.staticIndex : -1);
                w.u8(tile.blendMode || 0);
                writeProps(w, tile.props);
            } else {
                w.u8(0x41); // 'A'
                w.i32(tile.frameInterval || 100);
                const frames = tile.frames || [];
                w.i32(frames.length);
                let   frameTs = currTs;
                for (const fr of frames) {
                    if (fr.tilesheet !== frameTs) {
                        w.u8(0x54); w.str(fr.tilesheet); frameTs = fr.tilesheet; // 'T'
                    }
                    w.u8(0x53); // 'S'
                    w.i32(fr.tileIndex || 0);
                    w.u8(0); // blendMode per-frame (not stored in JS repr)
                    writeProps(w, {}); // frame props (empty in our JS repr)
                }
                writeProps(w, tile.props);
            }
        }
        if (nulls > 0) { w.u8(0x4E); w.i32(nulls); } // trailing nulls
    }
}

// ─── Map ──────────────────────────────────────────────────────────────────────
function readMap(buf) {
    const r = new Br(buf);
    const magic = buf.toString('ascii', 0, 6); r.p = 6;
    if (magic !== 'tBIN10') throw new Error('Not a valid .tbin file (expected magic "tBIN10")');

    const map = { id: r.str(), desc: r.str(), props: readProps(r), tilesheets: [], layers: [] };

    const tsCount = r.i32();
    for (let i = 0; i < tsCount; i++) map.tilesheets.push(readTilesheet(r));

    const lCount = r.i32();
    for (let i = 0; i < lCount; i++) map.layers.push(readLayer(r));

    return map;
}

function writeMap(map) {
    const w = new Bw();
    w.raw(Buffer.from('tBIN10', 'ascii'));
    w.str(map.id   || '');
    w.str(map.desc || '');
    writeProps(w, map.props);

    const tss = map.tilesheets || [];
    w.i32(tss.length);
    for (const ts of tss) writeTilesheet(w, ts);

    const ls = map.layers || [];
    w.i32(ls.length);
    for (const l of ls) writeLayer(w, l);

    return w.buf();
}

// ─── Public API (mirrors native addon) ────────────────────────────────────────
module.exports = {
    loadMap(filePath) {
        return readMap(fs.readFileSync(filePath));
    },
    saveMap(filePath, mapData) {
        fs.writeFileSync(filePath, writeMap(mapData));
    },
    validateMap(filePath) {
        try {
            const b = fs.readFileSync(filePath);
            return b.toString('ascii', 0, 6) === 'tBIN10';
        } catch { return false; }
    },
    getVersion() { return '1.0.0-js'; },
};
