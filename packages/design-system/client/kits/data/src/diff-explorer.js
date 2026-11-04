function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function formatExplorerValue(value) {
  if (value === null || value === void 0 || value === "") return "-";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value, null, 2) ?? String(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}
function stableValue(value) {
  if (value === void 0) return "__red_ui_undefined__";
  try {
    return JSON.stringify(isRecord(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value);
  } catch {
    return String(value);
  }
}
function explorerFields(entry) {
  const before = isRecord(entry.before) ? entry.before : {};
  const after = isRecord(entry.after) ? entry.after : {};
  return [.../* @__PURE__ */ new Set([...Object.keys(before), ...Object.keys(after)])].sort((a, b) => a.localeCompare(b)).map((field) => {
    const previous = before[field], next = after[field];
    const beforeHas = Object.hasOwn(before, field), afterHas = Object.hasOwn(after, field);
    const status = !beforeHas && afterHas ? "added" : beforeHas && !afterHas ? "removed" : stableValue(previous) === stableValue(next) ? "unchanged" : "modified";
    return { field, before: previous, after: next, status };
  });
}
function filterExplorerEntries(entries, filter) {
  const query = filter.trim().toLowerCase();
  if (!query) return [...entries];
  return entries.filter((entry) => [entry.id, entry.change, entry.group ?? "", entry.entityId ?? "", formatExplorerValue(entry.before), formatExplorerValue(entry.after)].some((value) => value.toLowerCase().includes(query)));
}
function summarizeExplorerEntries(entries) {
  const counts = /* @__PURE__ */ new Map();
  for (const entry of entries) counts.set(entry.change, (counts.get(entry.change) ?? 0) + 1);
  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
}
export {
  explorerFields,
  filterExplorerEntries,
  formatExplorerValue,
  summarizeExplorerEntries
};
