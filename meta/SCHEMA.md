# Meta

Index for the `emu.layle.dev` site. Screenshots themselves live in Cloudflare R2 (`screenshots.layle.dev`).

---

## `emulators/<slug>.json`

One file per emulator.

```json
{
  "slug": "gecko",
  "name": "gecko",
  "console": "GameCube",
  "description": "A GameCube emulator written in Rust.",
  "repo_url": "https://github.com/ioncodes/gecko",
  "commit_url_template": "https://github.com/ioncodes/gecko/commit/{sha}",
  "accent_color": "#6b9fff",
  "icon": "simple-icons:nintendogamecube"
}
```

- `slug`: matches the filename and the R2 key prefix. `[a-z0-9-]+`.
- `commit_url_template`: the site substitutes `{sha}` when rendering commit links.
- `icon` (optional): an [Iconify](https://icon-sets.iconify.design/) slug in `prefix:name` form.
- `first_game_frame` (optional): frames below this index are BIOS/boot animation.
  The compare view only counts frames from this index onwards when deciding
  whether a game gained or lost screenshots — without it, every game "has
  screenshots" because the BIOS always renders. Defaults to 0 (all frames count).

## `submissions/<emulator>/<YYYY-MM-DD>-<short_sha>.json`

One file per submission. A submission pins one emulator commit to a set of known games and their PNGs. A game can appear in `games` with zero entries in `screenshots`. The site shows "No screenshots available" for those.

```json
{
  "emulator": "gecko",
  "commit": "a3f9b2c9d4e5f67890abcdef1234567890abcdef",
  "commit_short": "a3f9b2c",
  "parent": "88eedd11...",
  "branch": "main",
  "commit_message": "fix: correct EFB copy alpha blending",
  "commit_timestamp": "2026-04-15T14:32:11Z",
  "submitted_at": "2026-04-17T09:12:00Z",
  "submitted_by": "layle",
  "games": [
    { "game_id": "GALE01", "game_title": "Super Smash Bros. Melee" },
    { "game_id": "GCRASH", "game_title": "Broken Game" }
  ],
  "screenshots": [
    {
      "game_id": "GALE01",
      "frame_index": 0,
      "r2_key": "v2/9f86d081...png",
      "width": 640,
      "height": 480,
      "sha256": "9f86d081..."
    }
  ],
  "demos": [
    {
      "game_id": "GALE01",
      "r2_key": "v2/1b4f0e98...webp",
      "width": 640,
      "height": 480,
      "sha256": "1b4f0e98..."
    }
  ]
}
```

- `games`: every known game at this commit. Sorted by `game_id`.
- `game_id`: opaque string from the emulator (GameCube disc ID, GBA header code, ...). Must match `[A-Za-z0-9_-]+`.
- `frame_index`: 0-based integer, unique within `(game_id, commit)`. Gaps allowed.
- `r2_key`: relative to the bucket; the site prefixes `https://screenshots.layle.dev/`.
  Keys are content-addressed: `v2/<sha256>.png`. Byte-identical PNGs (the same
  frame across commits/games) therefore share a single R2 object. Legacy
  `<emulator>/<short>/<game_id>/<frame>.png` objects still exist in the bucket for
  older data but are no longer referenced.
- `screenshots`: sorted by `(game_id, frame_index)`. `game_title` is only in `games`.
- `demos` (optional): at most one animated demo per game, keyed by `game_id` and
  sorted by it. Sourced from a `demo.gif` in the game's input directory, then
  re-encoded to lossless WebP (the tool keeps the original GIF only if it happens
  to be smaller). Content-addressed like screenshots over the uploaded bytes, so
  the key ends in `.webp` or `.gif` (`v2/<sha256>.<ext>`) and an unchanged demo
  shares one R2 object. Older submissions predate this field and omit it. The site
  pins the demo to the left of a game's screenshot strip so it stays visible while
  the frames scroll.

## `games/<emulator>/<game_id>.json`

TODO
