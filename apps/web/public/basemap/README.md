# Offline basemap

`hanoi.pmtiles` is not stored here by default. Create it once with:

    PMTILES_BIN=/path/to/pmtiles ./tools/fetch-basemap.sh

The web app (`src/components/map/basemap.ts`) uses this file when it is present and valid, and otherwise falls back to the
public OpenStreetMap raster tiles; the map legend says which one is active.

Data: OpenStreetMap contributors, ODbL 1.0. Extract tool: go-pmtiles (BSD-3-Clause). Protomaps basemap tile schema.
