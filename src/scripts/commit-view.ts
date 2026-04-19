interface Frame {
  src: string;
  w: number;
  h: number;
  i: number;
}

interface GameFrames {
  game_id: string;
  frames: Frame[];
}

const dataTag = document.getElementById("frames-data");
const entries: GameFrames[] = dataTag ? JSON.parse(dataTag.textContent ?? "[]") : [];
const framesByGame = new Map(entries.map((e) => [e.game_id, e.frames]));

hydrateRowsOnScroll();
wireFilter();
wireFrameViewer();
wireCommitCombo();

function hydrateRowsOnScroll() {
  const rows = document.querySelectorAll<HTMLElement>('.game-row[data-has-frames="true"]');
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
  const frames = framesByGame.get(gameId);
  const container = row.querySelector<HTMLElement>(".frames-container");
  if (!frames || !container) return;
  container.innerHTML = frames
    .map(
      (f, idx) =>
        `<img src="${f.src}" width="${f.w}" height="${f.h}" loading="lazy"` +
        ` data-frame-idx="${idx}"` +
        ` class="h-32 w-auto shrink-0 cursor-pointer rounded border border-neutral-200 dark:border-neutral-800"` +
        ` alt="${escapeAttr(title)} frame ${f.i}" />`,
    )
    .join("");
  container.style.minHeight = "";
  // scroll to rightmost frame on first reveal
  requestAnimationFrame(() => {
    container.scrollLeft = container.scrollWidth;
  });
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
  const rows = document.querySelectorAll<HTMLElement>(".game-row");
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

  let currentFrames: Frame[] | null = null;
  let currentIdx = 0;

  document.addEventListener("click", (ev) => {
    const target = ev.target as HTMLElement;
    const clickedImg = target.closest(".frames-container img") as HTMLImageElement | null;
    if (!clickedImg) return;
    const row = clickedImg.closest(".game-row") as HTMLElement | null;
    if (!row) return;
    const gameId = row.dataset.gameId!;
    const frames = framesByGame.get(gameId);
    if (!frames) return;
    const idx = parseInt(clickedImg.dataset.frameIdx ?? "0", 10);
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
    update();
    viewer!.classList.remove("hidden");
    viewer!.classList.add("flex");
    document.body.style.overflow = "hidden";
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
    img!.width = f.w;
    img!.height = f.h;
    indicator!.textContent = `${currentIdx + 1} / ${currentFrames.length}`;
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
