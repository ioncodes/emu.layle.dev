# emu.layle.dev

Screenshot archive for my emulators. Screenshots live in Cloudflare R2, metadata is JSON in this repo. See `meta/SCHEMA.md` if I forget.

## Layout

```
src/              Astro site
meta/             JSON index
tools/            Helpers
```

## Local dev

```bash
npm install
npm run dev       # http://localhost:4321
npm run build     # -> dist/
npm run preview   # serves dist/
```

## Deployment

Will go to Cloudflare Pages WIP
