import type { CommitData } from "@/lib/diff";
import { createFrameZoom } from "./frame-zoom";
import { wireScrollShadows } from "./scroll-shadows";

interface Frame {
  src: string;
  w: number;
  h: number;
  i: number;
  demo?: boolean;
}

interface CommitConfig {
  emu: string;
  commit: string;
  base: string;
}

const cfgTag = document.getElementById("commit-config");
const cfg: CommitConfig | null = cfgTag ? JSON.parse(cfgTag.textContent ?? "null") : null;

let framesByGame = new Map<string, Frame[]>();

wireFilter();
wireViewToggle();
wireFrameViewer();
wireCommitCombo();
wireCompareCombo();
if (cfg) void loadFrames(cfg);

async function loadFrames(c: CommitConfig) {
  try {
    const res = await fetch(`/data/${c.emu}/${c.commit}.json`);
    if (!res.ok) return;

    const data = (await res.json()) as CommitData;
    const demos = data.demos ?? {};

    // A game can have a demo, screenshots, or both. Keep the demo first (it's
    // pinned on the left) followed by the frames in order; hydrate() splits them
    // into the pinned demo container and the scrolling strip, but the combined
    // order drives the viewer.
    framesByGame = new Map();
    const ids = new Set([...Object.keys(data.shots), ...Object.keys(demos)]);
    for (const id of ids) {
      const media: Frame[] = [];

      const demo = demos[id];
      if (demo) {
        const [key, w, h] = demo;
        media.push({ src: `${c.base}/${key}`, w, h, i: -1, demo: true });
      }

      for (const [i, key, w, h] of data.shots[id] ?? []) {
        media.push({ src: `${c.base}/${key}`, w, h, i });
      }

      framesByGame.set(id, media);
    }
  } catch {
    return;
  }

  hydrateRowsOnScroll();
}

function hydrateRowsOnScroll() {
  const rows = document.querySelectorAll<HTMLElement>(
    '.game-row[data-has-frames="true"], .game-row[data-has-demo="true"]',
  );
  const io = new IntersectionObserver(
    (events) => {
      for (const e of events) {
        if (!e.isIntersecting) continue;
        hydrate(e.target as HTMLElement);
        io.unobserve(e.target);
      }
    },
    { rootMargin: "400px 0px" },
  );

  rows.forEach((row) => io.observe(row));
}

function hydrate(row: HTMLElement) {
  const gameId = row.dataset.gameId!;
  const title = row.dataset.title ?? gameId;
  const media = framesByGame.get(gameId);
  const container = row.querySelector<HTMLElement>(".frames-container");
  if (!media || !container) return;

  const tile = (f: Frame, idx: number) => {
    const alt = f.demo ? `${escapeAttr(title)} demo` : `${escapeAttr(title)} frame ${f.i}`;
    return (
      `<img src="${f.src}" width="${f.w}" height="${f.h}" loading="lazy"` +
      ` data-frame-idx="${idx}"` +
      ` class="h-32 w-auto shrink-0 cursor-pointer rounded border border-neutral-200 dark:border-neutral-800"` +
      ` alt="${alt}" />`
    );
  };

  // Screenshots go in the scrolling strip; the demo lives in its own pinned
  // container beside it so it stays visible while the strip scrolls. Both keep
  // their index into `media` so the fullscreen viewer can navigate all tiles.
  container.innerHTML = media.map((f, idx) => (f.demo ? "" : tile(f, idx))).join("");
  container.style.minHeight = "";

  const demoContainer = row.querySelector<HTMLElement>(".demo-container");
  if (demoContainer) {
    const demoIdx = media.findIndex((f) => f.demo);
    if (demoIdx >= 0) demoContainer.innerHTML = tile(media[demoIdx], demoIdx);
    demoContainer.style.minHeight = "";
  }

  const bar = row.querySelector<HTMLElement>(".frames-scrollbar");
  const thumb = bar?.querySelector<HTMLElement>(".frames-scrollbar-thumb") ?? null;

  requestAnimationFrame(() => {
    container.scrollLeft = container.scrollWidth;
    if (bar && thumb) wireScrollbar(container, bar, thumb);
    wireScrollShadows(container);
  });
}

// A custom always-visible horizontal scrollbar for a frame strip. Firefox on
// Linux auto-hides native overlay scrollbars with no CSS opt-out, so we draw and
// drive our own thumb from the strip's scroll position.
function wireScrollbar(strip: HTMLElement, bar: HTMLElement, thumb: HTMLElement) {
  function sync() {
    const overflow = strip.scrollWidth - strip.clientWidth;
    if (overflow <= 1) {
      bar.hidden = true;
      return;
    }

    bar.hidden = false;

    const track = bar.clientWidth;
    const thumbWidth = Math.max(24, Math.round(track * (strip.clientWidth / strip.scrollWidth)));
    const maxLeft = track - thumbWidth;
    const left = Math.round((strip.scrollLeft / overflow) * maxLeft);

    thumb.style.width = `${thumbWidth}px`;
    thumb.style.transform = `translateX(${left}px)`;
  }

  strip.addEventListener("scroll", sync, { passive: true });
  new ResizeObserver(sync).observe(strip);

  // Images can widen the strip after they decode; re-sync when they load.
  strip.querySelectorAll("img").forEach((img) => {
    if (!img.complete) img.addEventListener("load", sync, { once: true });
  });

  let startX = 0;
  let startScroll = 0;

  function onMove(ev: PointerEvent) {
    const overflow = strip.scrollWidth - strip.clientWidth;
    const maxLeft = bar.clientWidth - thumb.clientWidth;
    if (maxLeft <= 0) return;

    const dx = ev.clientX - startX;
    strip.scrollLeft = startScroll + (dx / maxLeft) * overflow;
  }

  function onUp() {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
  }

  thumb.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    startX = ev.clientX;
    startScroll = strip.scrollLeft;
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  });

  sync();
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
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
  const rows = document.querySelectorAll<HTMLElement>(".game-row, .matrix-cell");
  for (const row of rows) {
    const title = (row.dataset.title ?? "").toLowerCase();
    const id = (row.dataset.gameId ?? "").toLowerCase();
    const match = !q || title.includes(q) || id.includes(q);
    row.classList.toggle("hidden", !match);
  }
}

// List <-> demos-only grid switch. The toggle only exists in the DOM when the
// commit has demos, so this no-ops otherwise. The demos view is URL-addressable
// via ?view=demos so it can be linked and bookmarked directly.
function wireViewToggle() {
  const toggle = document.getElementById("view-toggle");
  const listEl = document.getElementById("games-list");
  const matrixEl = document.getElementById("games-matrix");
  if (!toggle || !listEl || !matrixEl) return;

  const buttons = Array.from(toggle.querySelectorAll<HTMLButtonElement>("button[data-view]"));

  function setView(view: string, updateUrl: boolean) {
    const demos = view === "demos";
    listEl!.hidden = demos;
    matrixEl!.hidden = !demos;

    for (const b of buttons) {
      b.setAttribute("aria-pressed", String(b.dataset.view === view));
    }

    try {
      localStorage.setItem("emu-demo-view", view);
    } catch {
      // ignore storage failures (private mode, etc.)
    }

    if (updateUrl) {
      const url = new URL(window.location.href);
      if (demos) url.searchParams.set("view", "demos");
      else url.searchParams.delete("view");
      history.replaceState(null, "", url);
    }
  }

  for (const b of buttons) {
    b.addEventListener("click", () => setView(b.dataset.view ?? "list", true));
  }

  // URL wins, then the last-used preference, else the list.
  const fromUrl = new URLSearchParams(window.location.search).get("view");
  let initial = fromUrl;

  if (initial !== "demos" && initial !== "list") {
    try {
      initial = localStorage.getItem("emu-demo-view");
    } catch {
      initial = null;
    }
  }

  setView(initial === "demos" ? "demos" : "list", false);
}

function wireFrameViewer() {
  const viewer = document.getElementById("frame-viewer");
  const scroll = document.getElementById("frame-viewer-scroll");
  const img = document.getElementById("frame-viewer-img") as HTMLImageElement | null;
  const indicator = document.getElementById("frame-viewer-indicator");
  const closeBtn = document.getElementById("frame-viewer-close");
  if (!viewer || !scroll || !img || !indicator || !closeBtn) return;

  const zoom = createFrameZoom(scroll, img, indicator, close);

  let currentFrames: Frame[] | null = null;
  let currentIdx = 0;

  document.addEventListener("click", (ev) => {
    const target = ev.target as HTMLElement;
    const clickedImg = target.closest(
      ".frames-container img, .demo-container img, .matrix-cell img",
    ) as HTMLImageElement | null;
    if (!clickedImg) return;
    const row = clickedImg.closest(".game-row, .matrix-cell") as HTMLElement | null;
    if (!row) return;
    const gameId = row.dataset.gameId!;
    const frames = framesByGame.get(gameId);
    if (!frames) return;

    // Matrix cells carry no per-frame index; open them on the demo tile.
    let idx = parseInt(clickedImg.dataset.frameIdx ?? "", 10);
    if (Number.isNaN(idx)) idx = Math.max(0, frames.findIndex((f) => f.demo));

    open(frames, idx);
  });

  closeBtn.addEventListener("click", close);

  viewer.addEventListener("click", (ev) => {
    if (ev.target === viewer) close();
  });

  document.addEventListener("keydown", (ev) => {
    if (!currentFrames) return;
    if (ev.key === "Escape") close();
    else if (ev.key === "ArrowRight" && currentIdx < currentFrames.length - 1) {
      currentIdx++;
      update();
    } else if (ev.key === "ArrowLeft" && currentIdx > 0) {
      currentIdx--;
      update();
    }
  });

  function open(frames: Frame[], idx: number) {
    currentFrames = frames;
    currentIdx = idx;

    viewer!.classList.remove("hidden");
    viewer!.classList.add("flex");
    document.body.style.overflow = "hidden";

    update();
  }

  function close() {
    viewer!.classList.add("hidden");
    viewer!.classList.remove("flex");
    document.body.style.overflow = "";
    currentFrames = null;
  }

  function update() {
    if (!currentFrames) return;
    const f = currentFrames[currentIdx];
    img!.src = f.src;
    zoom.setImage(f.w, f.h, `${currentIdx + 1} / ${currentFrames.length}`);
  }
}

interface CommitEntry {
  short: string;
  msg: string;
  ts: string;
}

function wireCommitCombo() {
  const dataTag = document.getElementById("commits-data");
  const input = document.getElementById("commit-combo-input") as HTMLInputElement | null;
  const list = document.getElementById("commit-combo-list");
  if (!dataTag || !input || !list) return;

  const payload = JSON.parse(dataTag.textContent ?? "{}") as {
    emu: string;
    commits: CommitEntry[];
  };
  const { emu, commits } = payload;
  let highlight = -1;

  function render(q: string) {
    const ql = q.toLowerCase();
    const matches = commits.filter(
      (c) => c.short.toLowerCase().startsWith(ql) || c.msg.toLowerCase().includes(ql),
    );
    if (matches.length === 0) {
      list!.innerHTML =
        '<li class="px-3 py-2 text-neutral-500">No matches</li>';
    } else {
      list!.innerHTML = matches
        .map(
          (c, i) =>
            `<li role="option" data-short="${c.short}" data-idx="${i}"` +
            ` class="cursor-pointer px-3 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-800">` +
            `<span class="font-mono">${c.short}</span>` +
            `<span class="ml-2 text-neutral-600 dark:text-neutral-400">${escapeText(c.msg)}</span>` +
            `</li>`,
        )
        .join("");
    }

    highlight = -1;
    list!.classList.remove("hidden");
    input!.setAttribute("aria-expanded", "true");
  }

  function hide() {
    list!.classList.add("hidden");
    input!.setAttribute("aria-expanded", "false");
  }

  function setHighlight(i: number) {
    const items = list!.querySelectorAll<HTMLElement>("li[role='option']");
    items.forEach((el, idx) =>
      el.classList.toggle("bg-neutral-100", idx === i),
    );
    items.forEach((el, idx) =>
      el.classList.toggle("dark:bg-neutral-800", idx === i),
    );

    highlight = i;
    const el = items[i];
    if (el) el.scrollIntoView({ block: "nearest" });
  }

  function navTo(short: string) {
    if (!short) return;
    window.location.href = `/${emu}/${short}`;
  }

  function escapeText(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  input.addEventListener("focus", () => {
    input.select();
    render("");
  });

  input.addEventListener("input", () => render(input.value));

  input.addEventListener("blur", () => {
    // defer so click on item fires first
    setTimeout(hide, 120);
  });

  input.addEventListener("keydown", (ev) => {
    const items = list!.querySelectorAll<HTMLElement>("li[role='option']");
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      if (items.length) setHighlight(Math.min(highlight + 1, items.length - 1));
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      if (items.length) setHighlight(Math.max(highlight - 1, 0));
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      const el = items[highlight] ?? items[0];
      if (el) navTo(el.dataset.short ?? "");
    } else if (ev.key === "Escape") {
      hide();
      input.blur();
    }
  });

  list.addEventListener("mousedown", (ev) => {
    const target = (ev.target as HTMLElement).closest("li[role='option']") as HTMLElement | null;
    if (!target) return;
    navTo(target.dataset.short ?? "");
  });
}

function wireCompareCombo() {
  const dataTag = document.getElementById("compare-data");
  const trigger = document.getElementById("compare-combo-trigger") as HTMLButtonElement | null;
  const input = document.getElementById("compare-combo-input") as HTMLInputElement | null;
  const list = document.getElementById("compare-combo-list");
  if (!dataTag || !trigger || !input || !list) return;

  const payload = JSON.parse(dataTag.textContent ?? "{}") as {
    emu: string;
    currentShort: string;
    commits: CommitEntry[];
  };
  const { emu, currentShort, commits } = payload;
  let highlight = -1;

  function escapeText(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function render(q: string) {
    const ql = q.toLowerCase();
    const matches = commits.filter(
      (c) => c.short.toLowerCase().startsWith(ql) || c.msg.toLowerCase().includes(ql),
    );
    if (matches.length === 0) {
      list!.innerHTML = '<li class="px-3 py-2 text-neutral-500">No matches</li>';
    } else {
      list!.innerHTML = matches
        .map(
          (c, i) =>
            `<li role="option" data-short="${c.short}" data-idx="${i}"` +
            ` class="cursor-pointer px-3 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-800">` +
            `<span class="font-mono">${c.short}</span>` +
            `<span class="ml-2 text-neutral-600 dark:text-neutral-400">${escapeText(c.msg)}</span>` +
            `</li>`,
        )
        .join("");
    }

    highlight = -1;
    list!.classList.remove("hidden");
    input!.setAttribute("aria-expanded", "true");
  }

  function show() {
    trigger!.classList.add("hidden");
    input!.classList.remove("hidden");
    input!.value = "";
    input!.focus();
    render("");
  }

  function hide() {
    list!.classList.add("hidden");
    input!.classList.add("hidden");
    trigger!.classList.remove("hidden");
    input!.setAttribute("aria-expanded", "false");
    trigger!.setAttribute("aria-expanded", "false");
  }

  function setHighlight(i: number) {
    const items = list!.querySelectorAll<HTMLElement>("li[role='option']");
    items.forEach((el, idx) => {
      el.classList.toggle("bg-neutral-100", idx === i);
      el.classList.toggle("dark:bg-neutral-800", idx === i);
    });

    highlight = i;
    const el = items[i];
    if (el) el.scrollIntoView({ block: "nearest" });
  }

  function navTo(short: string) {
    if (!short || short === currentShort) return;
    window.location.href = `/${emu}/compare/${encodeURIComponent(currentShort)}/${encodeURIComponent(short)}`;
  }

  trigger.addEventListener("click", () => {
    trigger.setAttribute("aria-expanded", "true");
    show();
  });

  input.addEventListener("input", () => render(input.value));

  input.addEventListener("blur", () => setTimeout(hide, 120));

  input.addEventListener("keydown", (ev) => {
    const items = list!.querySelectorAll<HTMLElement>("li[role='option']");
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      if (items.length) setHighlight(Math.min(highlight + 1, items.length - 1));
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      if (items.length) setHighlight(Math.max(highlight - 1, 0));
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      const el = items[highlight] ?? items[0];
      if (el) navTo(el.dataset.short ?? "");
    } else if (ev.key === "Escape") {
      hide();
    }
  });

  list.addEventListener("mousedown", (ev) => {
    const target = (ev.target as HTMLElement).closest("li[role='option']") as HTMLElement | null;
    if (!target) return;
    navTo(target.dataset.short ?? "");
  });
}
