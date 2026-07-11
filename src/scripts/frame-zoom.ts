// Integer nearest-neighbour zoom for the fullscreen frame viewer.
//
// Emulator frames are tiny native resolutions (GB 160x144, SNES 256x224, …), so
// blowing them up with the browser's default smoothing turns pixel art to mush.
// Instead we snap to whole-pixel scales (1x, 2x, 4x, 8x …) and render pixelated,
// defaulting to the largest scale that still fits the screen. Zooming past that
// lets you pan around for pixel-level inspection.

const CANDIDATE_SCALES = [1, 2, 3, 4, 6, 8, 12, 16];

interface ZoomController {
  setImage(w: number, h: number, label: string): void;
  setLabel(label: string): void;
}

export function createFrameZoom(
  scroll: HTMLElement,
  img: HTMLImageElement,
  indicator: HTMLElement,
  onBackgroundClick: () => void,
): ZoomController {
  let natW = 0;
  let natH = 0;
  let label = "";
  let levels: number[] = [1];
  let idx = 0;
  let fitIdx = 0;

  img.classList.add("[image-rendering:pixelated]");

  function buildLevels(w: number, h: number) {
    const vw = window.innerWidth * 0.94;
    const vh = window.innerHeight * 0.94;

    const fit = Math.max(1, Math.floor(Math.min(vw / w, vh / h)));

    const set = new Set<number>(CANDIDATE_SCALES.filter((s) => s <= fit));
    set.add(fit);

    // Always offer one step beyond "fits on screen" so there's something to pan
    // into, even on a platform whose native frame already fills the viewport.
    const next = CANDIDATE_SCALES.find((s) => s > fit);
    if (next) set.add(next);

    levels = [...set].sort((a, b) => a - b);
    fitIdx = levels.indexOf(fit);
  }

  function apply(recenter: boolean) {
    const scale = levels[idx];

    img.style.width = `${natW * scale}px`;
    img.style.height = `${natH * scale}px`;

    const overflow =
      natW * scale > scroll.clientWidth || natH * scale > scroll.clientHeight;
    scroll.classList.toggle("cursor-grab", overflow);
    scroll.classList.toggle("cursor-zoom-in", !overflow);

    indicator.textContent = label ? `${label} · ${scale}×` : `${scale}×`;

    if (recenter) {
      requestAnimationFrame(() => {
        scroll.scrollLeft = (scroll.scrollWidth - scroll.clientWidth) / 2;
        scroll.scrollTop = (scroll.scrollHeight - scroll.clientHeight) / 2;
      });
    }
  }

  function zoom(dir: number) {
    const nextIdx = Math.min(Math.max(idx + dir, 0), levels.length - 1);
    if (nextIdx === idx) return;

    idx = nextIdx;
    apply(true);
  }

  // Click the image to zoom in a step; past the top, wrap back to the fit level.
  let moved = false;
  img.addEventListener("click", (ev) => {
    ev.stopPropagation();
    if (moved) return;

    idx = idx >= levels.length - 1 ? fitIdx : idx + 1;
    apply(true);
  });

  // Clicks that miss the image (the dim backdrop) close the viewer.
  scroll.addEventListener("click", (ev) => {
    if (ev.target !== img && !moved) onBackgroundClick();
  });

  scroll.addEventListener(
    "wheel",
    (ev) => {
      ev.preventDefault();
      zoom(ev.deltaY < 0 ? 1 : -1);
    },
    { passive: false },
  );

  document.addEventListener("keydown", (ev) => {
    if (scroll.offsetParent === null) return;

    if (ev.key === "+" || ev.key === "=") zoom(1);
    else if (ev.key === "-" || ev.key === "_") zoom(-1);
    else if (ev.key === "0") {
      idx = fitIdx;
      apply(true);
    }
  });

  // Drag to pan when the frame is bigger than the viewport.
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let startL = 0;
  let startT = 0;

  scroll.addEventListener("pointerdown", (ev) => {
    if (ev.target !== img) return;

    dragging = true;
    moved = false;
    startX = ev.clientX;
    startY = ev.clientY;
    startL = scroll.scrollLeft;
    startT = scroll.scrollTop;
  });

  window.addEventListener("pointermove", (ev) => {
    if (!dragging) return;

    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;

    scroll.scrollLeft = startL - dx;
    scroll.scrollTop = startT - dy;
  });

  window.addEventListener("pointerup", () => {
    dragging = false;
  });

  return {
    setImage(w, h, next) {
      natW = w;
      natH = h;
      label = next;

      buildLevels(w, h);
      idx = fitIdx;
      apply(true);
    },
    setLabel(next) {
      label = next;
      apply(false);
    },
  };
}
