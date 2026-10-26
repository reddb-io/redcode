function statusCounts(items) {
  const ids = /* @__PURE__ */ new Set();
  let total = 0;
  for (const item of items) {
    if (!item.id || ids.has(item.id))
      throw new Error("StatusBreakdown: ids must be non-empty and unique.");
    if (!Number.isSafeInteger(item.count) || item.count < 0)
      throw new Error(
        "StatusBreakdown: counts must be non-negative safe integers."
      );
    ids.add(item.id);
    total += item.count;
    if (!Number.isSafeInteger(total))
      throw new Error("StatusBreakdown: total exceeds safe integer range.");
  }
  return {
    total,
    items: items.map((item) => ({
      ...item,
      fraction: total ? item.count / total : 0,
      paint: item.tone && item.tone !== "neutral" ? `var(--reddb-color-feedback-${item.tone}-foreground)` : "var(--reddb-color-ink-muted)"
    }))
  };
}
export {
  statusCounts
};
