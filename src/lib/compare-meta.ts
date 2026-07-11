import {
  formatTimestamp,
  type DiffEntry,
  type DiffGroups,
  type DiffResult,
  type Frame,
} from "./diff";

// Shared between the static compare template (build time) and the Cloudflare
// Pages Function that serves arbitrary pairs (request time). Keep this framework
// agnostic — no Astro, no Node — so the Function can import it verbatim.

export interface OgImage {
  url: string;
  width: number;
  height: number;
  alt: string;
}

export interface CompareMetaInput {
  title: string;
  description: string;
  pageUrl: string;
  accentColor?: string;
  image?: OgImage | null;
}

// The Function locates this region by literal string match and swaps in the
// per-pair meta. The template renders the block once with generic defaults.
export const CM_START = "<!--compare-meta-->";
export const CM_END = "<!--/compare-meta-->";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// The most recent "new" frame in the diff, preferring gained screenshots, then
// added games, then changed frames. This is the single source for the embed
// image — the static page and the Function both call it.
export function pickCover(groups: DiffGroups): { frame: Frame; title: string } | null {
  const order: DiffEntry[][] = [groups.gainedScreenshots, groups.gameAdded, groups.framesChanged];

  for (const entries of order) {
    const hit = lastNewFrame(entries);
    if (hit) return hit;
  }

  return null;
}

function lastNewFrame(entries: DiffEntry[]): { frame: Frame; title: string } | null {
  for (const entry of entries) {
    if (entry.kind === "frames-changed") {
      for (let i = entry.perFrame.length - 1; i >= 0; i--) {
        const pf = entry.perFrame[i];
        if (pf.k === "c") return { frame: pf.b, title: entry.title };
        if (pf.k === "a") return { frame: pf.f, title: entry.title };
      }
    } else if (entry.frames.length > 0) {
      return { frame: entry.frames[entry.frames.length - 1], title: entry.title };
    }
  }

  return null;
}

export function describeDiff(
  totals: DiffResult["totals"],
  aShort: string,
  aTimestamp: string,
  bShort: string,
  bTimestamp: string,
): string {
  const parts: string[] = [];

  if (totals.gameAdded > 0) parts.push(`${totals.gameAdded} games added`);
  if (totals.gameRemoved > 0) parts.push(`${totals.gameRemoved} games removed`);
  if (totals.gainedScreenshots > 0) parts.push(`${totals.gainedScreenshots} gained screenshots`);
  if (totals.lostScreenshots > 0) parts.push(`${totals.lostScreenshots} lost screenshots`);
  if (totals.framesChanged > 0) parts.push(`${totals.framesChanged} frames changed`);

  return [
    parts.length > 0 ? parts.join(" · ") : "No differences detected",
    `${aShort} (${formatTimestamp(aTimestamp)}) → ${bShort} (${formatTimestamp(bTimestamp)})`,
  ].join("\n");
}

export function renderCompareMeta(m: CompareMetaInput): string {
  const t = esc(m.title);
  const d = esc(m.description);
  const url = esc(m.pageUrl);

  const tags = [
    `<meta charset="UTF-8" />`,
    `<meta name="viewport" content="width=device-width, initial-scale=1" />`,
    `<title>${t}</title>`,
    `<meta name="robots" content="noindex" />`,
    `<meta name="description" content="${d}" />`,
  ];

  if (m.accentColor) tags.push(`<meta name="theme-color" content="${esc(m.accentColor)}" />`);

  tags.push(
    `<meta property="og:site_name" content="emu.layle.dev" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:title" content="${t}" />`,
    `<meta property="og:description" content="${d}" />`,
  );

  if (m.image) {
    tags.push(
      `<meta property="og:image" content="${esc(m.image.url)}" />`,
      `<meta property="og:image:width" content="${m.image.width}" />`,
      `<meta property="og:image:height" content="${m.image.height}" />`,
      `<meta property="og:image:alt" content="${esc(m.image.alt)}" />`,
    );
  }

  tags.push(
    `<meta name="twitter:card" content="${m.image ? "summary_large_image" : "summary"}" />`,
    `<meta name="twitter:title" content="${t}" />`,
    `<meta name="twitter:description" content="${d}" />`,
  );

  if (m.image) tags.push(`<meta name="twitter:image" content="${esc(m.image.url)}" />`);

  return tags.join("\n");
}

export function compareMetaBlock(m: CompareMetaInput): string {
  return `${CM_START}${renderCompareMeta(m)}${CM_END}`;
}

// Swap the marked meta region for a freshly rendered one. Plain string slicing
// so it stays dependency free inside the Function.
export function replaceCompareMeta(html: string, m: CompareMetaInput): string {
  const start = html.indexOf(CM_START);
  const end = html.indexOf(CM_END);
  if (start === -1 || end === -1) return html;

  return html.slice(0, start) + compareMetaBlock(m) + html.slice(end + CM_END.length);
}
