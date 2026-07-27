# Deferred Lyrics/LRC

## Current scope

Lyrics/LRC support is deferred from the current v1 scope.

The current wallpaper must not expose:

- `lyrics` settings schema fields
- lyrics layout items or lyrics-focused presets
- Wallpaper Engine lyrics properties
- runtime LRC parsing or synced lyrics display
- external lyrics provider calls

Legacy settings JSON containing a top-level `lyrics` object must be repaired by dropping that object while keeping the wallpaper running.

## Hard rules

Do not bundle lyrics data. Do not scrape lyrics. Do not ship external lyrics provider integrations by default.

## Reintroduction requirements

Before Lyrics/LRC is reintroduced, update these in the same phase:

- product scope
- settings schema
- layout spec
- Wallpaper Engine property spec
- Rust/WASM responsibility spec
- QA checklist
- user guide
- automated tests
- SpecGuard checklist

A future provider boundary should describe provider name, search inputs, synced/plain support, cache policy, and failure reason.
