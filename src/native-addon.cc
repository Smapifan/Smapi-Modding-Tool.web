/*
 * Stardew Valley Map Editor – Native Node.js Addon
 * Bridges tbin::Map (C++) to JavaScript via Node-API (N-API).
 *
 * Exposed API:
 *   loadMap(filePath: string): object   – load a .tbin file → JS object
 *   saveMap(filePath: string, data: object): void – save JS object → .tbin file
 *   validateMap(filePath: string): boolean – quick magic-byte check
 *   getVersion(): string – addon version string
 *
 * tbin::Tile struct layout (from Tile.hpp):
 *   tile.tilesheet               – shared tilesheet ID string
 *   tile.staticData.tileIndex    – int32_t (-1 = null tile)
 *   tile.staticData.blendMode    – uint8_t
 *   tile.animatedData.frameInterval – int32_t
 *   tile.animatedData.frames     – vector<Tile> (non-empty = animated tile)
 *   tile.props                   – Properties map
 *   tile.isNullTile()            – bool method (not a field)
 */

#include <napi.h>
#include <fstream>
#include <stdexcept>
#include <string>
#include <vector>

// Qt compatibility shim (defines QT_TRANSLATE_NOOP and a stub QDebug)
#ifndef QT_TRANSLATE_NOOP
#define QT_TRANSLATE_NOOP(ctx, str) (str)
#endif

#include "tbin/Map.hpp"
#include "tbin/Layer.hpp"
#include "tbin/TileSheet.hpp"
#include "tbin/Tile.hpp"
#include "tbin/PropertyValue.hpp"

// ---------------------------------------------------------------------------
// Helper: tbin::Properties → Napi::Object
// ---------------------------------------------------------------------------
static Napi::Object PropsToJS(Napi::Env env, const tbin::Properties& props)
{
    Napi::Object obj = Napi::Object::New(env);
    for (const auto& kv : props) {
        const tbin::PropertyValue& v = kv.second;
        switch (v.type) {
            case tbin::PropertyValue::Bool:
                obj.Set(kv.first, Napi::Boolean::New(env, v.data.b));   break;
            case tbin::PropertyValue::Integer:
                obj.Set(kv.first, Napi::Number::New(env, v.data.i));    break;
            case tbin::PropertyValue::Float:
                obj.Set(kv.first, Napi::Number::New(env, v.data.f));    break;
            case tbin::PropertyValue::String:
                obj.Set(kv.first, Napi::String::New(env, v.dataStr));   break;
            default: break;
        }
    }
    return obj;
}

// ---------------------------------------------------------------------------
// Helper: Napi::Object → tbin::Properties
// ---------------------------------------------------------------------------
static tbin::Properties JSToProps(Napi::Env /*env*/, const Napi::Object& obj)
{
    tbin::Properties props;
    Napi::Array keys = obj.GetPropertyNames();
    for (uint32_t i = 0; i < keys.Length(); ++i) {
        std::string key = keys.Get(i).As<Napi::String>().Utf8Value();
        Napi::Value val = obj.Get(key);
        tbin::PropertyValue pv;
        if (val.IsBoolean()) {
            pv.type = tbin::PropertyValue::Bool;
            pv.data.b = val.As<Napi::Boolean>().Value();
        } else if (val.IsNumber()) {
            double d = val.As<Napi::Number>().DoubleValue();
            if (d == static_cast<int32_t>(d)) {
                pv.type = tbin::PropertyValue::Integer;
                pv.data.i = static_cast<int32_t>(d);
            } else {
                pv.type = tbin::PropertyValue::Float;
                pv.data.f = static_cast<float>(d);
            }
        } else {
            pv.type = tbin::PropertyValue::String;
            pv.dataStr = val.ToString().Utf8Value();
        }
        props[key] = pv;
    }
    return props;
}

// ---------------------------------------------------------------------------
// Helper: tbin::Tile → Napi::Object
// ---------------------------------------------------------------------------
static Napi::Object TileToJS(Napi::Env env, const tbin::Tile& tile)
{
    Napi::Object to = Napi::Object::New(env);
    bool isNull = tile.isNullTile();
    bool isAnim = !tile.animatedData.frames.empty();

    to.Set("isNull",     Napi::Boolean::New(env, isNull));
    to.Set("isAnimated", Napi::Boolean::New(env, isAnim));

    if (!isNull) {
        to.Set("props", PropsToJS(env, tile.props));
        if (isAnim) {
            to.Set("frameInterval", Napi::Number::New(env, tile.animatedData.frameInterval));
            Napi::Array frames = Napi::Array::New(env, tile.animatedData.frames.size());
            for (size_t fi = 0; fi < tile.animatedData.frames.size(); ++fi) {
                const tbin::Tile& fr = tile.animatedData.frames[fi];
                Napi::Object fo = Napi::Object::New(env);
                fo.Set("tilesheet",  Napi::String::New(env, fr.tilesheet));
                fo.Set("tileIndex",  Napi::Number::New(env, fr.staticData.tileIndex));
                frames.Set(fi, fo);
            }
            to.Set("frames", frames);
        } else {
            to.Set("staticTilesheet", Napi::String::New(env, tile.tilesheet));
            to.Set("staticIndex",     Napi::Number::New(env, tile.staticData.tileIndex));
            to.Set("blendMode",       Napi::Number::New(env, tile.staticData.blendMode));
        }
    }
    return to;
}

// ---------------------------------------------------------------------------
// Helper: JS tile value → tbin::Tile
// ---------------------------------------------------------------------------
static tbin::Tile JSTile(Napi::Env env, Napi::Value val)
{
    tbin::Tile tile;  // default: isNullTile() == true (tileIndex == -1, no frames)
    if (val.IsNull() || val.IsUndefined()) return tile;

    Napi::Object to = val.As<Napi::Object>();
    bool isNull = to.Has("isNull") && to.Get("isNull").As<Napi::Boolean>().Value();
    if (isNull) return tile;

    bool isAnim = to.Has("isAnimated") && to.Get("isAnimated").As<Napi::Boolean>().Value();
    if (to.Has("props") && to.Get("props").IsObject()) {
        tile.props = JSToProps(env, to.Get("props").As<Napi::Object>());
    }

    if (isAnim && to.Has("frames") && to.Get("frames").IsArray()) {
        Napi::Array frames = to.Get("frames").As<Napi::Array>();
        tile.animatedData.frameInterval = to.Has("frameInterval")
            ? to.Get("frameInterval").As<Napi::Number>().Int32Value() : 100;
        tile.animatedData.frames.reserve(frames.Length());
        for (uint32_t fi = 0; fi < frames.Length(); ++fi) {
            tbin::Tile frame;
            Napi::Object fo = frames.Get(fi).As<Napi::Object>();
            frame.tilesheet            = fo.Get("tilesheet").ToString().Utf8Value();
            frame.staticData.tileIndex = fo.Get("tileIndex").As<Napi::Number>().Int32Value();
            tile.animatedData.frames.push_back(frame);
        }
    } else if (!isAnim) {
        tile.tilesheet = to.Has("staticTilesheet")
            ? to.Get("staticTilesheet").ToString().Utf8Value() : "";
        tile.staticData.tileIndex = to.Has("staticIndex")
            ? to.Get("staticIndex").As<Napi::Number>().Int32Value() : -1;
        tile.staticData.blendMode = to.Has("blendMode")
            ? static_cast<uint8_t>(to.Get("blendMode").As<Napi::Number>().Int32Value()) : 0;
    }
    return tile;
}

// ---------------------------------------------------------------------------
// loadMap(filePath) → JS map object
// ---------------------------------------------------------------------------
static Napi::Value LoadMap(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "Expected string filePath").ThrowAsJavaScriptException();
        return env.Null();
    }
    std::string filePath = info[0].As<Napi::String>().Utf8Value();
    tbin::Map tmap;
    try {
        if (!tmap.loadFromFile(filePath)) {
            Napi::Error::New(env, "Failed to load: " + filePath).ThrowAsJavaScriptException();
            return env.Null();
        }
    } catch (const std::exception& e) {
        Napi::Error::New(env, std::string("Error: ") + e.what()).ThrowAsJavaScriptException();
        return env.Null();
    }

    Napi::Object result = Napi::Object::New(env);
    result.Set("id",   Napi::String::New(env, tmap.id));
    result.Set("desc", Napi::String::New(env, tmap.desc));
    result.Set("props", PropsToJS(env, tmap.props));

    // Tilesheets
    Napi::Array tsheets = Napi::Array::New(env, tmap.tilesheets.size());
    for (size_t ti = 0; ti < tmap.tilesheets.size(); ++ti) {
        const tbin::TileSheet& ts = tmap.tilesheets[ti];
        Napi::Object tso = Napi::Object::New(env);
        tso.Set("id",          Napi::String::New(env, ts.id));
        tso.Set("desc",        Napi::String::New(env, ts.desc));
        tso.Set("imagePath",   Napi::String::New(env, ts.image));
        tso.Set("sheetWidth",  Napi::Number::New(env, ts.sheetSize.x));
        tso.Set("sheetHeight", Napi::Number::New(env, ts.sheetSize.y));
        tso.Set("tileWidth",   Napi::Number::New(env, ts.tileSize.x));
        tso.Set("tileHeight",  Napi::Number::New(env, ts.tileSize.y));
        tso.Set("props",       PropsToJS(env, ts.props));
        tsheets.Set(ti, tso);
    }
    result.Set("tilesheets", tsheets);

    // Layers
    Napi::Array layers = Napi::Array::New(env, tmap.layers.size());
    for (size_t li = 0; li < tmap.layers.size(); ++li) {
        const tbin::Layer& layer = tmap.layers[li];
        Napi::Object lo = Napi::Object::New(env);
        lo.Set("id",          Napi::String::New(env, layer.id));
        lo.Set("desc",        Napi::String::New(env, layer.desc));
        lo.Set("visible",     Napi::Boolean::New(env, layer.visible));
        lo.Set("layerWidth",  Napi::Number::New(env, layer.layerSize.x));
        lo.Set("layerHeight", Napi::Number::New(env, layer.layerSize.y));
        lo.Set("tileWidth",   Napi::Number::New(env, layer.tileSize.x));
        lo.Set("tileHeight",  Napi::Number::New(env, layer.tileSize.y));
        lo.Set("props",       PropsToJS(env, layer.props));
        Napi::Array tilesArr = Napi::Array::New(env, layer.tiles.size());
        for (size_t idx = 0; idx < layer.tiles.size(); ++idx) {
            tilesArr.Set(idx, TileToJS(env, layer.tiles[idx]));
        }
        lo.Set("tiles", tilesArr);
        layers.Set(li, lo);
    }
    result.Set("layers", layers);
    return result;
}

// ---------------------------------------------------------------------------
// saveMap(filePath, mapData) → undefined
// ---------------------------------------------------------------------------
static Napi::Value SaveMap(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsString() || !info[1].IsObject()) {
        Napi::TypeError::New(env, "Expected (filePath: string, mapData: object)")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }
    std::string filePath = info[0].As<Napi::String>().Utf8Value();
    Napi::Object data    = info[1].As<Napi::Object>();

    tbin::Map tmap;
    tmap.id   = data.Get("id").ToString().Utf8Value();
    tmap.desc = data.Get("desc").ToString().Utf8Value();
    if (data.Has("props") && data.Get("props").IsObject())
        tmap.props = JSToProps(env, data.Get("props").As<Napi::Object>());

    if (data.Has("tilesheets") && data.Get("tilesheets").IsArray()) {
        Napi::Array tsheets = data.Get("tilesheets").As<Napi::Array>();
        for (uint32_t ti = 0; ti < tsheets.Length(); ++ti) {
            Napi::Object tso = tsheets.Get(ti).As<Napi::Object>();
            tbin::TileSheet ts;
            ts.id          = tso.Get("id").ToString().Utf8Value();
            ts.desc        = tso.Get("desc").ToString().Utf8Value();
            ts.image       = tso.Get("imagePath").ToString().Utf8Value();
            ts.sheetSize.x = tso.Get("sheetWidth").As<Napi::Number>().Int32Value();
            ts.sheetSize.y = tso.Get("sheetHeight").As<Napi::Number>().Int32Value();
            ts.tileSize.x  = tso.Get("tileWidth").As<Napi::Number>().Int32Value();
            ts.tileSize.y  = tso.Get("tileHeight").As<Napi::Number>().Int32Value();
            if (tso.Has("props") && tso.Get("props").IsObject())
                ts.props = JSToProps(env, tso.Get("props").As<Napi::Object>());
            tmap.tilesheets.push_back(ts);
        }
    }

    if (data.Has("layers") && data.Get("layers").IsArray()) {
        Napi::Array layers = data.Get("layers").As<Napi::Array>();
        for (uint32_t li = 0; li < layers.Length(); ++li) {
            Napi::Object lo = layers.Get(li).As<Napi::Object>();
            tbin::Layer layer;
            layer.id          = lo.Get("id").ToString().Utf8Value();
            layer.desc        = lo.Get("desc").ToString().Utf8Value();
            layer.visible     = !lo.Has("visible") || lo.Get("visible").As<Napi::Boolean>().Value();
            layer.layerSize.x = lo.Get("layerWidth").As<Napi::Number>().Int32Value();
            layer.layerSize.y = lo.Get("layerHeight").As<Napi::Number>().Int32Value();
            layer.tileSize.x  = lo.Get("tileWidth").As<Napi::Number>().Int32Value();
            layer.tileSize.y  = lo.Get("tileHeight").As<Napi::Number>().Int32Value();
            if (lo.Has("props") && lo.Get("props").IsObject())
                layer.props = JSToProps(env, lo.Get("props").As<Napi::Object>());
            if (lo.Has("tiles") && lo.Get("tiles").IsArray()) {
                Napi::Array tilesArr = lo.Get("tiles").As<Napi::Array>();
                layer.tiles.reserve(tilesArr.Length());
                for (uint32_t idx = 0; idx < tilesArr.Length(); ++idx)
                    layer.tiles.push_back(JSTile(env, tilesArr.Get(idx)));
            }
            tmap.layers.push_back(layer);
        }
    }

    try {
        if (!tmap.saveToFile(filePath))
            Napi::Error::New(env, "Failed to save: " + filePath).ThrowAsJavaScriptException();
    } catch (const std::exception& e) {
        Napi::Error::New(env, std::string("Error: ") + e.what()).ThrowAsJavaScriptException();
    }
    return env.Undefined();
}

// ---------------------------------------------------------------------------
// validateMap(filePath) → boolean
// ---------------------------------------------------------------------------
static Napi::Value ValidateMap(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsString())
        return Napi::Boolean::New(env, false);
    std::string fp = info[0].As<Napi::String>().Utf8Value();
    std::ifstream f(fp, std::ios::in | std::ios::binary);
    if (!f) return Napi::Boolean::New(env, false);
    std::string magic(6, '\0');
    f.read(&magic[0], 6);
    return Napi::Boolean::New(env, magic == "tBIN10");
}

// ---------------------------------------------------------------------------
// getVersion() → string
// ---------------------------------------------------------------------------
static Napi::Value GetVersion(const Napi::CallbackInfo& info)
{
    return Napi::String::New(info.Env(), "1.0.0");
}

// ---------------------------------------------------------------------------
// Module init
// ---------------------------------------------------------------------------
static Napi::Object Init(Napi::Env env, Napi::Object exports)
{
    exports.Set("loadMap",     Napi::Function::New(env, LoadMap));
    exports.Set("saveMap",     Napi::Function::New(env, SaveMap));
    exports.Set("validateMap", Napi::Function::New(env, ValidateMap));
    exports.Set("getVersion",  Napi::Function::New(env, GetVersion));
    return exports;
}

NODE_API_MODULE(tbin_addon, Init)
