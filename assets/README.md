# Asset Library

This folder contains the asset library for the Stardew Valley Map Editor.

## Structure

```
assets/
├── tilesheets/     ← Place tilesheet PNG images here
├── maps/           ← Sample .tbin map files
├── objects/        ← Object sprite images (optional)
└── library.json    ← Asset catalog (auto-read by the editor)
```

## How it works

When you open a `.tbin` file that references tilesheets (e.g. `spring_outdoors`),
the editor first checks whether a matching image has already been loaded.
If not, it searches `assets/tilesheets/` via `library.json` and loads the image
automatically — no manual file-picker needed.

Custom images you load via **[Img]** or drag-and-drop always take priority over
library images.

## Adding tilesheets

1. Copy your PNG tilesheet into `assets/tilesheets/`
2. Add an entry to `library.json` under `"tilesheets"` (or the editor will still
   detect files whose filename matches the tilesheet ID exactly)

## Adding sample maps

Place `.tbin` files in `assets/maps/`.  They appear in `library.json` under
`"maps"` and can be opened normally via **File → Open**.

## Stardew Valley game assets

The game's own tilesheet images are **not** distributed here (they are
copyrighted by ConcernedApe). Extract them from your own game installation
(`Content/Maps/`, `Content/TileSheets/`) and place the PNG files in
`assets/tilesheets/`.

Common tilesheets used by Stardew Valley maps:

| Tilesheet ID              | Game file                              |
|---------------------------|----------------------------------------|
| `spring_outdoors`         | `Maps/spring_outdoors.png`             |
| `summer_outdoors`         | `Maps/summer_outdoors.png`             |
| `fall_outdoors`           | `Maps/fall_outdoors.png`               |
| `winter_outdoors`         | `Maps/winter_outdoors.png`             |
| `mine_stone_tile_sheet`   | `Maps/mine_stone_tile_sheet.png`       |
| `Flooring`                | `Maps/Flooring.png`                    |
| `walls_and_floors`        | `Maps/walls_and_floors.png`            |
| `paths`                   | `Maps/paths.png`                       |
| `furniture`               | `Maps/furniture.png`                   |
