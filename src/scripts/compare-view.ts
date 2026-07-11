import {
  computeDiff,
  formatTimestamp,
  type CommitData,
  type DiffEntry,
  type DiffGroups,
  type Frame,
  type PerFrame,
} from "@/lib/diff";
import { wireScrollShadows } from "./scroll-shadows";

interface Config {
  emu: string;
  name: string;
  base: string;
  commitUrlTemplate: string;
  firstGameFrame: number;
}

const cfgTag = document.getElementById("compare-config");
const cfg: Config | null = cfgTag ? JSON.parse(cfgTag.textContent ?? "null") : null;

const statusEl = document.getElementById("compare-status");
const headerEl = document.getElementById("compare-header");
const sectionsEl = document.getElementById("compare-sections");

// The pair comes from the URL, not baked config: the path form
// /:emu/compare/:a/:b (served by the Pages Function) or the query form
// /:emu/compare?a=..&b=.. both render from the same template.
function resolvePair(): { a: string; b: string } {
  const segs = window.location.pathname.split("/").filter(Boolean);
  const ci = segs.indexOf("compare");
  if (ci >= 0 && segs.length >= ci + 3) {
    return { a: decodeURIComponent(segs[ci + 1]), b: decodeURIComponent(segs[ci + 2]) };
  }

  const q = new URLSearchParams(window.location.search);
  return { a: q.get("a") ?? "", b: q.get("b") ?? "" };
}

const { a: aShort, b: bShort } = resolvePair();
const firstGameFrame = cfg?.firstGameFrame ?? 0;
const bootNote = firstGameFrame > 0 ? ` Boot frames (#0–#${firstGameFrame - 1}) are ignored.` : "";

const SECTIONS: {
  id: string;
  key: keyof DiffGroups;
  title: string;
  desc: (a: string, b: string) => string;
  badge: string;
}[] = [
  {
    id: "game-added",
    key: "gameAdded",
    title: "Games added",
    desc: (a, b) => `Present in ${b} but not ${a}.`,
    badge: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  },
  {
    id: "game-removed",
    key: "gameRemoved",
    title: "Games removed",
    desc: (a, b) => `Present in ${a} but not ${b}.`,
    badge: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  },
  {
    id: "gained",
    key: "gainedScreenshots",
    title: "Gained screenshots",
    desc: (a, b) => `Had 0 frames in ${a}, has frames in ${b}.${bootNote}`,
    badge: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  },
  {
    id: "lost",
    key: "lostScreenshots",
    title: "Lost screenshots",
    desc: (a, b) => `Had frames in ${a}, has 0 frames in ${b}.${bootNote}`,
    badge: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  },
  {
    id: "changed",
    key: "framesChanged",
    title: "Frames changed",
    desc: () => `Same game, but at least one frame differs (key, count, or index).`,
    badge: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  },
];

void main();

async function main() {
  if (!cfg || !headerEl || !sectionsEl || !statusEl) return;
  if (!aShort || !bShort) {
    statusEl.textContent = "Pick two commits to compare.";
    return;
  }

  statusEl.textContent = "Loading…";

  let a: CommitData;
  let b: CommitData;
  try {
    [a, b] = await Promise.all([fetchCommit(aShort), fetchCommit(bShort)]);
  } catch (err) {
    statusEl.textContent = `Could not load data: ${(err as Error).message}`;
    return;
  }

  const diff = computeDiff(a, b, { firstGameFrame });
  renderHeader(a, b, diff.totals);

  const total =
    diff.totals.gameAdded +
    diff.totals.gameRemoved +
    diff.totals.gainedScreenshots +
    diff.totals.lostScreenshots +
    diff.totals.framesChanged;

  if (total === 0) {
    statusEl.innerHTML = `<p class="text-sm italic text-neutral-500">No differences detected between ${a.commit_short} and ${b.commit_short}.</p>`;
  } else {
    statusEl.textContent = "";
    renderSections(diff.groups, a.commit_short, b.commit_short);
    hydrateRowsOnScroll();
  }

  wireFilter();
  wireFrameViewer();
}

async function fetchCommit(short: string): Promise<CommitData> {
  const res = await fetch(`/data/${cfg!.emu}/${short}.json`);
  if (!res.ok) throw new Error(`${short} (${res.status})`);

  return (await res.json()) as CommitData;
}

function icon(paths: string, size: number, cls: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24"` +
    ` fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"` +
    ` class="inline-block shrink-0 ${cls}" aria-hidden="true">${paths}</svg>`
  );
}

const ARROW_RIGHT = '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>';
const ARROW_UP_RIGHT = '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>';
const ARROW_LEFT_RIGHT =
  '<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>';

function renderHeader(a: CommitData, b: CommitData, totals: Record<keyof DiffGroups, number>) {
  const aUrl = cfg!.commitUrlTemplate.replace("{sha}", a.commit);
  const bUrl = cfg!.commitUrlTemplate.replace("{sha}", b.commit);
  const swapHref = `/${cfg!.emu}/compare/${encodeURIComponent(b.commit_short)}/${encodeURIComponent(a.commit_short)}`;

  const linkCls = "font-mono text-neutral-600 hover:underline dark:text-neutral-400";
  const extCls =
    "inline-flex items-center text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300";

  const badges = SECTIONS.map((s) => {
    const n = totals[s.key];
    const href = n > 0 ? `href="#section-${s.id}"` : 'aria-disabled="true"';
    const state = n > 0 ? "hover:underline" : "opacity-40 cursor-default";

    return `<a ${href} class="rounded px-2 py-1 font-medium ${s.badge} ${state}">${n} ${s.title.toLowerCase()}</a>`;
  }).join("");

  headerEl!.innerHTML =
    `<div class="flex flex-wrap items-center gap-2 text-sm">` +
    `<a href="/${cfg!.emu}/${a.commit_short}" class="${linkCls}">${a.commit_short}</a>` +
    `<a href="${aUrl}" target="_blank" rel="noreferrer" class="${extCls}" aria-label="View commit A on remote">${icon(ARROW_UP_RIGHT, 14, "")}</a>` +
    icon(ARROW_RIGHT, 14, "text-neutral-400") +
    `<a href="/${cfg!.emu}/${b.commit_short}" class="${linkCls}">${b.commit_short}</a>` +
    `<a href="${bUrl}" target="_blank" rel="noreferrer" class="${extCls}" aria-label="View commit B on remote">${icon(ARROW_UP_RIGHT, 14, "")}</a>` +
    `<a href="${swapHref}" class="ml-2 inline-flex items-center gap-1.5 rounded border border-neutral-300 px-2 py-1 font-mono text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800" title="Swap direction">${icon(ARROW_LEFT_RIGHT, 12, "")}Swap</a>` +
    `<input id="game-filter" type="search" placeholder="Filter games..." aria-label="Filter games by title or id" class="ml-auto w-64 max-w-full rounded border border-neutral-300 bg-white px-3 py-1 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900" />` +
    `</div>` +
    `<dl class="mt-4 grid grid-cols-[auto_auto_1fr] gap-x-4 gap-y-1 text-xs text-neutral-600 dark:text-neutral-400">` +
    `<dt class="font-mono">${a.commit_short}</dt><dd class="font-mono text-neutral-500">${formatTimestamp(a.commit_timestamp)}</dd><dd class="truncate">${escapeText(a.commit_message)}</dd>` +
    `<dt class="font-mono">${b.commit_short}</dt><dd class="font-mono text-neutral-500">${formatTimestamp(b.commit_timestamp)}</dd><dd class="truncate">${escapeText(b.commit_message)}</dd>` +
    `</dl>` +
    `<div class="mt-4 flex flex-wrap gap-2 text-xs">${badges}</div>`;
}

// Hydration thunks, indexed by data-strip-id on each row.
const hydrators: ((container: HTMLElement) => void)[] = [];

function renderSections(groups: DiffGroups, aShortC: string, bShortC: string) {
  hydrators.length = 0;

  const html = SECTIONS.map((section) => {
    const entries = groups[section.key];
    if (entries.length === 0) return "";

    const rows = entries.map((entry) => renderRow(entry, aShortC, bShortC)).join("");

    return (
      `<section id="section-${section.id}" class="mb-12">` +
      `<header class="mb-4 flex items-baseline gap-3">` +
      `<h2 class="text-lg font-semibold">${section.title}</h2>` +
      `<span class="rounded px-2 py-0.5 text-xs font-medium ${section.badge}">${entries.length}</span>` +
      `<p class="text-xs text-neutral-500">${section.desc(aShortC, bShortC)}</p>` +
      `</header>` +
      `<ul class="space-y-6">${rows}</ul>` +
      `</section>`
    );
  }).join("");

  sectionsEl!.innerHTML = html;
}

const SINGLE_BORDER: Record<string, string> = {
  "game-added": "border-green-400 dark:border-green-700",
  "game-removed": "border-red-400 dark:border-red-700",
  "gained-screenshots": "border-emerald-400 dark:border-emerald-700",
  "lost-screenshots": "border-amber-400 dark:border-amber-700",
};

function renderRow(entry: DiffEntry, aShortC: string, bShortC: string): string {
  const stripId = hydrators.length;
  let meta = "";
  if (entry.kind === "frames-changed") {
    const parts: string[] = [];
    if (entry.changedCount > 0)
      parts.push(
        `<span class="mr-3"><span class="inline-block h-2 w-2 align-middle rounded-full bg-blue-500"></span> ${entry.changedCount} changed</span>`,
      );
    if (entry.addedCount > 0)
      parts.push(
        `<span class="mr-3"><span class="inline-block h-2 w-2 align-middle rounded-full bg-emerald-500"></span> ${entry.addedCount} added</span>`,
      );
    if (entry.removedCount > 0)
      parts.push(
        `<span class="mr-3"><span class="inline-block h-2 w-2 align-middle rounded-full bg-amber-500"></span> ${entry.removedCount} removed</span>`,
      );
    meta = `<p class="mt-2 text-xs text-neutral-500">${parts.join("")}</p>`;

    const perFrame = entry.perFrame;
    hydrators.push((c) => {
      c.innerHTML = perFrame.map((fd) => renderPaired(fd, entry.title, aShortC, bShortC)).join("");
      c.style.minHeight = "";
    });
  } else {
    const n = entry.frames.length;
    let caption = "";
    if (entry.kind === "game-added") caption = `${n} frame${n === 1 ? "" : "s"} in ${bShortC}`;
    else if (entry.kind === "game-removed") caption = `${n} frame${n === 1 ? "" : "s"} in ${aShortC}`;
    else if (entry.kind === "gained-screenshots")
      caption = `${n} new frame${n === 1 ? "" : "s"} in ${bShortC}`;
    else caption = `${n} frame${n === 1 ? "" : "s"} disappeared in ${bShortC}`;

    meta = `<p class="mt-2 text-xs text-neutral-500">${caption}</p>`;

    const border = SINGLE_BORDER[entry.kind];
    const frames = entry.frames;
    hydrators.push((c) => {
      c.innerHTML = frames.map((f) => renderSingle(f, border, entry.title)).join("");
      c.style.minHeight = "";
    });
  }

  return (
    `<li class="diff-row rounded border border-neutral-200 p-4 dark:border-neutral-800"` +
    ` data-game-id="${escapeAttr(entry.id)}" data-title="${escapeAttr(entry.title)}" data-strip-id="${stripId}">` +
    `<h3 class="flex items-baseline gap-3 text-sm"><span class="font-medium">${escapeText(entry.title)}</span>` +
    `<span class="font-mono text-xs text-neutral-500">${escapeText(entry.id)}</span></h3>` +
    meta +
    `<div class="frames-scroll relative mt-3">` +
    `<div class="frames-row flex gap-3 overflow-x-auto pb-1" style="min-height:148px"></div>` +
    `</div>` +
    `</li>`
  );
}

function renderSingle(f: Frame, border: string, title: string): string {
  return (
    `<img src="${cfg!.base}/${f.key}" width="${f.w}" height="${f.h}" loading="lazy"` +
    ` class="h-32 w-auto shrink-0 cursor-pointer rounded border-2 ${border}"` +
    ` alt="${escapeAttr(title)} frame ${f.i}" />`
  );
}

const ARROW_SVG = icon(ARROW_RIGHT, 14, "text-neutral-400");

function renderPaired(fd: PerFrame, title: string, aShortC: string, bShortC: string): string {
  const t = escapeAttr(title);
  if (fd.k === "c") {
    return (
      `<figure class="shrink-0"><div class="flex items-center gap-1">` +
      `<img src="${cfg!.base}/${fd.a.key}" width="${fd.a.w}" height="${fd.a.h}" loading="lazy"` +
      ` class="h-32 w-auto cursor-pointer rounded border-2 border-blue-400 dark:border-blue-700"` +
      ` alt="${t} frame ${fd.a.i} in ${aShortC}" />` +
      ARROW_SVG +
      `<img src="${cfg!.base}/${fd.b.key}" width="${fd.b.w}" height="${fd.b.h}" loading="lazy"` +
      ` class="h-32 w-auto cursor-pointer rounded border-2 border-blue-400 dark:border-blue-700"` +
      ` alt="${t} frame ${fd.b.i} in ${bShortC}" /></div>` +
      `<figcaption class="mt-1 font-mono text-[10px] text-blue-700 dark:text-blue-400">#${fd.b.i} changed</figcaption></figure>`
    );
  }

  if (fd.k === "s") {
    return (
      `<figure class="shrink-0"><img src="${cfg!.base}/${fd.b.key}" width="${fd.b.w}" height="${fd.b.h}" loading="lazy"` +
      ` class="h-32 w-auto cursor-pointer rounded border border-neutral-200 opacity-40 dark:border-neutral-800"` +
      ` alt="${t} frame ${fd.b.i} (unchanged)" />` +
      `<figcaption class="mt-1 font-mono text-[10px] text-neutral-500">#${fd.b.i} same</figcaption></figure>`
    );
  }

  if (fd.k === "a") {
    return (
      `<figure class="shrink-0"><img src="${cfg!.base}/${fd.f.key}" width="${fd.f.w}" height="${fd.f.h}" loading="lazy"` +
      ` class="h-32 w-auto cursor-pointer rounded border-2 border-emerald-400 dark:border-emerald-700"` +
      ` alt="${t} frame ${fd.f.i} (added)" />` +
      `<figcaption class="mt-1 font-mono text-[10px] text-emerald-600 dark:text-emerald-400">#${fd.f.i} added</figcaption></figure>`
    );
  }

  return (
    `<figure class="shrink-0"><img src="${cfg!.base}/${fd.f.key}" width="${fd.f.w}" height="${fd.f.h}" loading="lazy"` +
    ` class="h-32 w-auto cursor-pointer rounded border-2 border-amber-400 dark:border-amber-700"` +
    ` alt="${t} frame ${fd.f.i} (removed)" />` +
    `<figcaption class="mt-1 font-mono text-[10px] text-amber-700 dark:text-amber-400">#${fd.f.i} removed</figcaption></figure>`
  );
}

function hydrateRowsOnScroll() {
  const rows = document.querySelectorAll<HTMLElement>(".diff-row[data-strip-id]");
  const io = new IntersectionObserver(
    (events) => {
      for (const e of events) {
        if (!e.isIntersecting) continue;
        const row = e.target as HTMLElement;
        const id = parseInt(row.dataset.stripId ?? "-1", 10);
        const container = row.querySelector<HTMLElement>(".frames-row");
        const fn = hydrators[id];

        if (container && fn) {
          fn(container);
          wireScrollShadows(container);
        }
        io.unobserve(row);
      }
    },
    { rootMargin: "400px 0px" },
  );

  rows.forEach((row) => io.observe(row));
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function wireFilter() {
  const input = document.getElementById("game-filter") as HTMLInputElement | null;
  if (!input) return;

  let timer: number | undefined;
  input.addEventListener("input", () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => applyFilter(input.value.trim().toLowerCase()), 100);
  });
}

function applyFilter(q: string) {
  const rows = document.querySelectorAll<HTMLElement>(".diff-row");
  for (const row of rows) {
    const title = (row.dataset.title ?? "").toLowerCase();
    const id = (row.dataset.gameId ?? "").toLowerCase();
    const match = !q || title.includes(q) || id.includes(q);
    row.classList.toggle("hidden", !match);
  }
}

function wireFrameViewer() {
  const viewer = document.getElementById("frame-viewer");
  const img = document.getElementById("frame-viewer-img") as HTMLImageElement | null;
  const indicator = document.getElementById("frame-viewer-indicator");
  const closeBtn = document.getElementById("frame-viewer-close");
  if (!viewer || !img || !indicator || !closeBtn) return;

  let currentList: HTMLImageElement[] = [];
  let currentIdx = 0;

  document.addEventListener("click", (ev) => {
    const target = ev.target as HTMLElement;
    const clicked = target.closest(".frames-row img") as HTMLImageElement | null;
    if (!clicked) return;
    const row = clicked.closest(".diff-row") as HTMLElement | null;
    if (!row) return;
    const imgs = Array.from(row.querySelectorAll<HTMLImageElement>(".frames-row img"));
    const idx = imgs.indexOf(clicked);
    if (idx < 0) return;
    open(imgs, idx);
  });

  closeBtn.addEventListener("click", close);

  viewer.addEventListener("click", (ev) => {
    if (ev.target === viewer) close();
  });

  document.addEventListener("keydown", (ev) => {
    if (currentList.length === 0) return;
    if (ev.key === "Escape") close();
    else if (ev.key === "ArrowRight" && currentIdx < currentList.length - 1) {
      currentIdx++;
      update();
    } else if (ev.key === "ArrowLeft" && currentIdx > 0) {
      currentIdx--;
      update();
    }
  });

  function open(imgs: HTMLImageElement[], idx: number) {
    currentList = imgs;
    currentIdx = idx;
    update();

    viewer!.classList.remove("hidden");
    viewer!.classList.add("flex");
    document.body.style.overflow = "hidden";
  }

  function close() {
    viewer!.classList.add("hidden");
    viewer!.classList.remove("flex");
    document.body.style.overflow = "";
    currentList = [];
  }

  function update() {
    const el = currentList[currentIdx];
    if (!el) return;
    img!.src = el.src;
    indicator!.textContent = `${currentIdx + 1} / ${currentList.length}`;
  }
}
