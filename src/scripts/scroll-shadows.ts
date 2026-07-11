// Toggles edge-shadow hints on a horizontally scrollable frame strip. The
// shadows live on a non-scrolling `.frames-scroll` wrapper (as ::before/::after
// in global.css); here we just flip the data attributes that reveal them based
// on how far the strip is scrolled.
export function wireScrollShadows(scroller: HTMLElement) {
  const wrap = scroller.closest<HTMLElement>(".frames-scroll") ?? scroller.parentElement;
  if (!wrap) return;

  function update() {
    const overflow = scroller.scrollWidth - scroller.clientWidth;

    // Shadow on a side only when there is hidden content that way.
    const atStart = scroller.scrollLeft <= 1;
    const atEnd = overflow <= 1 || scroller.scrollLeft >= overflow - 1;

    wrap!.toggleAttribute("data-overflow-start", !atStart);
    wrap!.toggleAttribute("data-overflow-end", !atEnd);
  }

  scroller.addEventListener("scroll", update, { passive: true });
  new ResizeObserver(update).observe(scroller);

  // Images can widen the strip after they decode; re-check when they load.
  scroller.querySelectorAll("img").forEach((img) => {
    if (!img.complete) img.addEventListener("load", update, { once: true });
  });

  update();
}
