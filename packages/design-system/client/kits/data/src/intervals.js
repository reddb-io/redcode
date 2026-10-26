import { finite, unique } from "./visualization.js";
function intervalRows(data, collapsed = []) {
  unique(data, "Intervals");
  const byId = new Map(data.map((d) => [d.id, d])), hidden = new Set(collapsed);
  const result = [];
  for (const item of data) {
    finite(item.start, item.id);
    finite(item.end, item.id);
    if (item.end < item.start) throw new Error("Interval end precedes start");
    if (item.progress !== void 0 && (!Number.isFinite(item.progress) || item.progress < 0 || item.progress > 1)) throw new Error("Progress must be between zero and one");
    for (const id of item.dependencies ?? []) if (id === item.id || !byId.has(id)) throw new Error("Unknown or self dependency");
    let parent = item.parentId, depth = 0, visible = true;
    const visited = /* @__PURE__ */ new Set([item.id]);
    while (parent) {
      if (visited.has(parent)) throw new Error("Cyclic interval hierarchy");
      visited.add(parent);
      const p = byId.get(parent);
      if (!p) throw new Error("Unknown interval parent");
      if (hidden.has(parent)) visible = false;
      depth++;
      parent = p.parentId;
    }
    if (visible) result.push({ ...item, depth });
  }
  const ordered = [];
  function append(parentId) {
    for (const item of result.filter((r) => r.parentId === parentId)) {
      ordered.push(item);
      append(item.id);
    }
  }
  append();
  return ordered;
}
function intervalDomain(data, explicit) {
  if (explicit) {
    if (!explicit.every(Number.isFinite) || explicit[0] >= explicit[1]) throw new Error("Invalid time domain");
    return [...explicit];
  }
  if (!data.length) return [0, 1];
  let start = Infinity, end = -Infinity;
  for (const item of data) {
    start = Math.min(start, item.start);
    end = Math.max(end, item.end);
  }
  return [start, end > start ? end : start + 1];
}
export {
  intervalDomain,
  intervalRows
};
