const REVEAL_DIRECTIONS = ["up", "down", "left", "right", "none"];
function initialRevealState() {
  return { path: "js", entered: true, reducedMotion: false };
}
function revealDelay(delay) {
  if (!Number.isFinite(delay) || delay < 0) throw new Error("Reveal: delay must be finite and nonnegative.");
  return delay;
}
const offsets = {
  up: ["0px", "var(--reddb-spatial-inset-lg)"],
  down: ["0px", "calc(-1 * var(--reddb-spatial-inset-lg))"],
  left: ["calc(-1 * var(--reddb-spatial-inset-lg))", "0px"],
  right: ["var(--reddb-spatial-inset-lg)", "0px"],
  none: ["0px", "0px"]
};
function mountReveal(element, direction, delay, changed) {
  const path = delay === 0 && typeof CSS !== "undefined" && CSS.supports("animation-timeline: view()") ? "css" : "js";
  const preference = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : void 0;
  let animation, observer;
  let disposed = false, settled = false;
  function stop() {
    animation?.cancel();
    animation = void 0;
    observer?.disconnect();
    observer = void 0;
  }
  function sync() {
    stop();
    const reducedMotion = preference?.matches ?? false;
    if (reducedMotion || settled) {
      settled = true;
      changed({ path, entered: true, reducedMotion });
      return;
    }
    if (path === "css") {
      const ViewTimeline = globalThis.ViewTimeline;
      if (typeof element.animate !== "function" || !ViewTimeline) {
        changed({ path, entered: true, reducedMotion });
        return;
      }
      try {
        const [x, y] = offsets[direction];
        animation = element.animate([{ opacity: 0, transform: `translate3d(${x}, ${y}, 0)` }, { opacity: 1, transform: "translate3d(0, 0, 0)" }], {
          duration: 1,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
          fill: "both",
          timeline: new ViewTimeline({ subject: element }),
          rangeStart: "entry 0%",
          rangeEnd: "entry 35%"
        });
        changed({ path, entered: false, reducedMotion });
      } catch {
        changed({ path, entered: true, reducedMotion });
      }
      return;
    }
    if (typeof IntersectionObserver === "undefined") {
      changed({ path, entered: true, reducedMotion });
      return;
    }
    changed({ path, entered: false, reducedMotion });
    observer = new IntersectionObserver((entries) => {
      if (disposed || !entries.some((entry) => entry.isIntersecting)) return;
      settled = true;
      changed({ path, entered: true, reducedMotion: preference?.matches ?? false });
      observer?.disconnect();
      observer = void 0;
    });
    observer.observe(element);
  }
  sync();
  if (preference?.addEventListener) preference.addEventListener("change", sync);
  else preference?.addListener(sync);
  return () => {
    disposed = true;
    stop();
    if (preference?.removeEventListener) preference.removeEventListener("change", sync);
    else preference?.removeListener(sync);
  };
}
export {
  REVEAL_DIRECTIONS,
  initialRevealState,
  mountReveal,
  revealDelay
};
