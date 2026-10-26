import { tokenColor } from "@reddb-io/design-system/base/recipes";
const ink = "var(--reddb-color-foreground)";
const mutedInk = "var(--reddb-color-ink-muted)";
const edge = "var(--reddb-color-muted)";
const surface = "var(--reddb-color-elevation-raised-surface)";
function seriesColor(series = 1, color) {
  return tokenColor(color, `var(--reddb-color-series-${series})`);
}
function tint(color, amount = 15) {
  return `color-mix(in srgb, ${color} ${amount}%, var(--reddb-color-background))`;
}
function unique(items, subject) {
  const ids = /* @__PURE__ */ new Set();
  for (const item of items) {
    if (!item.id || ids.has(item.id)) throw new Error(`${subject}: duplicate or empty id ${item.id}`);
    ids.add(item.id);
  }
}
function finite(value, subject) {
  if (!Number.isFinite(value)) throw new Error(`${subject}: expected a finite number`);
  return value;
}
function domain(values, explicit) {
  if (explicit) {
    if (!explicit.every(Number.isFinite) || explicit[0] >= explicit[1]) throw new Error("Domain must be finite and increasing");
    return [explicit[0], explicit[1]];
  }
  if (!values.length) return [0, 1];
  let low = Infinity, high = -Infinity;
  for (const value of values) {
    finite(value, "Domain");
    low = Math.min(low, value);
    high = Math.max(high, value);
  }
  if (low === high) {
    const room = Math.abs(low) * 0.1 || 1;
    return [low - room, high + room];
  }
  return [low, high];
}
function project(value, range, start, end) {
  return start + (value - range[0]) / (range[1] - range[0]) * (end - start);
}
function ticks(range, count = 4) {
  return Array.from({ length: count + 1 }, (_, i) => range[0] + (range[1] - range[0]) * i / count);
}
function number(value) {
  return new Intl.NumberFormat("en", { notation: Math.abs(value) >= 1e4 ? "compact" : "standard", maximumFractionDigits: 2 }).format(value);
}
function short(value, length = 24) {
  return value.length > length ? `${value.slice(0, length - 1)}\u2026` : value;
}
export {
  domain,
  edge,
  finite,
  ink,
  mutedInk,
  number,
  project,
  seriesColor,
  short,
  surface,
  ticks,
  tint,
  unique
};
