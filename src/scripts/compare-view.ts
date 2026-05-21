type SingleFrame = [number, string, number, number];
type PairedFrame =
  | ["s" | "a" | "r", number, string, number, number]
  | ["c", number, string, number, number, string, number, number];
type Strip =
  | { k: "ga" | "gs"; f: SingleFrame[] }
  | { k: "gr" | "ls"; f: SingleFrame[] }
  | { k: "fc"; f: PairedFrame[] };

interface Payload {
  base: string;
  aShort: string;
  bShort: string;
  strips: Strip[];
}

const tag = document.getElementById("diff-strips");
const payload: Payload = tag
  ? JSON.parse(tag.textContent ?? "{}")
  : { base: "", aShort: "", bShort: "", strips: [] };

hydrateRowsOnScroll();
wireFilter();
wireFrameViewer();

function hydrateRowsOnScroll() {
  const rows = document.querySelectorAll<HTMLElement>(".diff-row[data-strip-id]");
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

const SINGLE_BORDER: Record<"ga" | "gr" | "gs" | "ls", string> = {
  ga: "border-green-400 dark:border-green-700",
  gr: "border-red-400 dark:border-red-700",
  gs: "border-emerald-400 dark:border-emerald-700",
  ls: "border-amber-400 dark:border-amber-700",
};

const ARROW_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="inline-block shrink-0 text-neutral-400" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>';

function hydrate(row: HTMLElement) {
  const id = parseInt(row.dataset.stripId ?? "-1", 10);
  if (isNaN(id) || id < 0) return;
  const strip = payload.strips[id];
  const container = row.querySelector<HTMLElement>(".frames-row");
  if (!strip || !container) return;
  const title = row.dataset.title ?? "";
  if (strip.k === "fc") {
    container.innerHTML = strip.f.map((fd) => renderPaired(fd, title)).join("");
  } else {
    const border = SINGLE_BORDER[strip.k];
    container.innerHTML = strip.f.map((f) => renderSingle(f, border, title)).join("");
  }
  container.style.minHeight = "";
}

function renderSingle(f: SingleFrame, border: string, title: string): string {
  const [idx, key, w, h] = f;
  return (
    `<img src="${payload.base}/${key}" width="${w}" height="${h}" loading="lazy"` +
    ` class="h-32 w-auto shrink-0 cursor-pointer rounded border-2 ${border}"` +
    ` alt="${escapeAttr(title)} frame ${idx}" />`
  );
}

function renderPaired(fd: PairedFrame, title: string): string {
  const t = escapeAttr(title);
  if (fd[0] === "c") {
    const [, idx, aKey, aW, aH, bKey, bW, bH] = fd;
    return (
      `<figure class="shrink-0">` +
      `<div class="flex items-center gap-1">` +
      `<img src="${payload.base}/${aKey}" width="${aW}" height="${aH}" loading="lazy"` +
      ` class="h-32 w-auto cursor-pointer rounded border-2 border-blue-400 dark:border-blue-700"` +
      ` alt="${t} frame ${idx} in ${payload.aShort}" />` +
      ARROW_SVG +
      `<img src="${payload.base}/${bKey}" width="${bW}" height="${bH}" loading="lazy"` +
      ` class="h-32 w-auto cursor-pointer rounded border-2 border-blue-400 dark:border-blue-700"` +
      ` alt="${t} frame ${idx} in ${payload.bShort}" />` +
      `</div>` +
      `<figcaption class="mt-1 font-mono text-[10px] text-blue-700 dark:text-blue-400">#${idx} changed</figcaption>` +
      `</figure>`
    );
  }
  const [kind, idx, key, w, h] = fd;
  if (kind === "s") {
    return (
      `<figure class="shrink-0">` +
      `<img src="${payload.base}/${key}" width="${w}" height="${h}" loading="lazy"` +
      ` class="h-32 w-auto cursor-pointer rounded border border-neutral-200 opacity-40 dark:border-neutral-800"` +
      ` alt="${t} frame ${idx} (unchanged)" />` +
      `<figcaption class="mt-1 font-mono text-[10px] text-neutral-500">#${idx} same</figcaption>` +
      `</figure>`
    );
  }
  if (kind === "a") {
    return (
      `<figure class="shrink-0">` +
      `<img src="${payload.base}/${key}" width="${w}" height="${h}" loading="lazy"` +
      ` class="h-32 w-auto cursor-pointer rounded border-2 border-emerald-400 dark:border-emerald-700"` +
      ` alt="${t} frame ${idx} (added)" />` +
      `<figcaption class="mt-1 font-mono text-[10px] text-emerald-600 dark:text-emerald-400">#${idx} added</figcaption>` +
      `</figure>`
    );
  }
  return (
    `<figure class="shrink-0">` +
    `<img src="${payload.base}/${key}" width="${w}" height="${h}" loading="lazy"` +
    ` class="h-32 w-auto cursor-pointer rounded border-2 border-amber-400 dark:border-amber-700"` +
    ` alt="${t} frame ${idx} (removed)" />` +
    `<figcaption class="mt-1 font-mono text-[10px] text-amber-700 dark:text-amber-400">#${idx} removed</figcaption>` +
    `</figure>`
  );
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
