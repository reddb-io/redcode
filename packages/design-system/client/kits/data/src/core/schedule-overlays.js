function scheduleOverlays(markers, windows, intervalIds) {
  for (const collection of [markers, windows]) {
    const ids = /* @__PURE__ */ new Set();
    for (const item of collection) {
      if (!item.id || ids.has(item.id))
        throw new Error("Schedule overlays need unique, non-empty ids.");
      ids.add(item.id);
    }
  }
  for (const marker of markers)
    if (!Number.isFinite(marker.time))
      throw new Error("Schedule marker time must be finite.");
  for (const window of windows) {
    if (!Number.isFinite(window.start) || !Number.isFinite(window.end) || window.start >= window.end)
      throw new Error("Schedule window must have a finite, increasing range.");
    if (window.intervalId !== void 0 && !intervalIds.includes(window.intervalId))
      throw new Error("Schedule window references an unknown interval.");
  }
  return { markers, windows };
}
function clippedWindow(start, end, domain) {
  const from = Math.max(start, domain[0]), to = Math.min(end, domain[1]);
  return to > from ? [from, to] : null;
}
function markerPaint(tone = "neutral") {
  return tone === "neutral" ? "var(--reddb-color-foreground)" : `var(--reddb-color-feedback-${tone}-foreground)`;
}
export {
  clippedWindow,
  markerPaint,
  scheduleOverlays
};
