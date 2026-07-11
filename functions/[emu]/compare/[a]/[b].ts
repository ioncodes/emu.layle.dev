import { computeDiff, type CommitData } from "../../../../src/lib/diff";
import {
  describeDiff,
  pickCover,
  replaceCompareMeta,
  type CompareMetaInput,
} from "../../../../src/lib/compare-meta";

// Serves /:emu/compare/:a/:b for any pair. Static Pages assets win over
// Functions, so this only ever runs for pairs we did not pre-generate — which
// is all of them now. It fetches the emulator's compare template, computes the
// per-pair diff, and injects the embed meta server-side so link previews work
// without executing any client JS.

type AssetFetcher = { fetch: (input: string) => Promise<Response> };

interface Ctx {
  request: Request;
  params: { emu: string; a: string; b: string };
  env: { ASSETS: AssetFetcher };
}

interface TemplateConfig {
  name: string;
  base: string;
  accentColor?: string;
  firstGameFrame: number;
}

export async function onRequestGet(context: Ctx): Promise<Response> {
  const { emu, a, b } = context.params;
  const origin = new URL(context.request.url).origin;

  const templateRes = await context.env.ASSETS.fetch(`${origin}/${emu}/compare/`);
  if (!templateRes.ok) {
    return new Response("Unknown emulator", { status: 404 });
  }

  let html = await templateRes.text();
  const cfg = parseConfig(html);

  const [dataA, dataB] = await Promise.all([
    fetchData(context.env.ASSETS, origin, emu, a),
    fetchData(context.env.ASSETS, origin, emu, b),
  ]);

  // With everything present we upgrade the generic template meta to per-pair.
  // If a commit is missing the template still renders and the client shows the
  // load error, so we return it untouched rather than 404.
  if (cfg && dataA && dataB) {
    html = replaceCompareMeta(html, buildMeta(context.request.url, cfg, dataA, dataB));
  }

  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function buildMeta(
  pageUrl: string,
  cfg: TemplateConfig,
  dataA: CommitData,
  dataB: CommitData,
): CompareMetaInput {
  const diff = computeDiff(dataA, dataB, { firstGameFrame: cfg.firstGameFrame });
  const description = describeDiff(
    diff.totals,
    dataA.commit_short,
    dataA.commit_timestamp,
    dataB.commit_short,
    dataB.commit_timestamp,
  );

  const cover = pickCover(diff.groups);
  const image = cover
    ? {
        url: `${cfg.base}/${cover.frame.key}`,
        width: cover.frame.w,
        height: cover.frame.h,
        alt: `${cover.title} running on ${cfg.name} at ${dataB.commit_short}`,
      }
    : null;

  return {
    title: `${cfg.name} / ${dataA.commit_short} → ${dataB.commit_short}`,
    description,
    pageUrl,
    accentColor: cfg.accentColor,
    image,
  };
}

// The template bakes its per-emulator config into an inline JSON tag; reuse it
// rather than re-reading the emulator metadata.
function parseConfig(html: string): TemplateConfig | null {
  const match = html.match(/<script[^>]*id="compare-config"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) return null;

  try {
    return JSON.parse(match[1]) as TemplateConfig;
  } catch {
    return null;
  }
}

async function fetchData(
  assets: AssetFetcher,
  origin: string,
  emu: string,
  short: string,
): Promise<CommitData | null> {
  try {
    const res = await assets.fetch(`${origin}/data/${emu}/${encodeURIComponent(short)}.json`);
    if (!res.ok) return null;

    return (await res.json()) as CommitData;
  } catch {
    return null;
  }
}
