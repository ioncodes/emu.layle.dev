wireFilter();
wireFrameViewer();

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
