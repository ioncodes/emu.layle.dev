import { defineMiddleware } from "astro:middleware";

// In production the pretty compare path /:emu/compare/:a/:b is served by the
// Cloudflare Pages Function. There is no Function under `astro dev`, so without
// this the in-app "compare" links 404 locally. Rewrite the pretty path to the
// per-emulator compare template — it renders the pair client-side from the URL,
// which stays /:emu/compare/:a/:b in the browser. This middleware does not run
// in the deployed static site; the Function handles it there (and adds OG meta).
const COMPARE_PAIR = /^\/([^/]+)\/compare\/([^/]+)\/([^/]+)\/?$/;

export const onRequest = defineMiddleware((context, next) => {
  const match = context.url.pathname.match(COMPARE_PAIR);
  if (match) {
    return context.rewrite(`/${match[1]}/compare/`);
  }

  return next();
});
