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

One file per submission. Each submission pins one emulator commit to a set of PNGs.

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
  "screenshots": [
    {
      "game_id": "GALE01",
      "game_title": "Super Smash Bros. Melee",
      "frame_index": 0,
      "r2_key": "gecko/a3f9b2c/GALE01/0.png",
      "width": 640,
      "height": 480,
      "sha256": "9f86d081..."
    }
  ]
}
```

- `game_id`: opaque string from the emulator (GameCube disc ID, GBA header code, …). Must match `[A-Za-z0-9_-]+`.
- `frame_index`: which frame the screenshot has been taken from.
- `r2_key`: relative to bucket, the site prefixes `https://screenshots.layle.dev/`.
- `screenshots`: array sorted by `(game_id, frame_index)` for diffing.

## `games/<emulator>/<game_id>.json`

TODO