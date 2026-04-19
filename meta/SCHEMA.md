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
  "accent_color": "#6b9fff"
}
```

- `slug`: matches the filename and the R2 key prefix. `[a-z0-9-]+`.
- `commit_url_template`: the site substitutes `{sha}` when rendering commit links.

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
      "r2_key": "gecko/a3f9b2c/GALE01/0.png",
      "width": 640,
      "height": 480,
      "sha256": "9f86d081..."
    }
  ]
}
```

- `games`: every known game at this commit. Sorted by `game_id`.
- `game_id`: opaque string from the emulator (GameCube disc ID, GBA header code, ...). Must match `[A-Za-z0-9_-]+`.
- `frame_index`: 0-based integer, unique within `(game_id, commit)`. Gaps allowed.
- `r2_key`: relative to the bucket. The site prefixes `https://screenshots.layle.dev/`.
- `screenshots`: sorted by `(game_id, frame_index)`. `game_title` is only in `games`.

## `games/<emulator>/<game_id>.json`

TODO
