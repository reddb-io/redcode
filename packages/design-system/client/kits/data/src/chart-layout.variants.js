import { tv } from "tailwind-variants";
import { CHART_ROWS } from "./chart.js";
const chartSurface = tv({
  base: "@container/chart group/chart relative flex min-h-0 min-w-0 flex-col",
  variants: { fill: { true: "h-full", false: "" } }
});
const overlay = [
  "pointer-events-none invisible absolute inset-x-0 bottom-0 z-10",
  "group-hover/chart:visible group-focus-within/chart:visible group-data-[chart-inspecting]/chart:visible",
  "border border-muted bg-elevation-overlay-surface px-[var(--reddb-spatial-inset-sm)]"
].join(" ");
function chartReadout(layout, mode) {
  if (mode === "hidden") return "sr-only";
  if (mode === "inline" || mode === "auto" && layout === "roomy") return "";
  if (mode === "overlay" || layout === "dense") return overlay;
  return `${overlay} @lg/chart:visible @lg/chart:static @lg/chart:border-0 @lg/chart:bg-transparent @lg/chart:px-0`;
}
function chartRows(layout, legacyRows, size) {
  return size ? CHART_ROWS[size] : layout === "dense" ? Math.min(6, legacyRows) : legacyRows;
}
function chartHeightStyle(layout, legacyRows, size, height) {
  if (height === "fill") return void 0;
  if (typeof height === "number") return `${height}px`;
  if (layout === "auto" && size === void 0) return "calc(var(--reddb-spatial-control-height-md) * var(--chart-layout-rows, 6))";
  return `calc(var(--reddb-spatial-control-height-md) * ${chartRows(layout, legacyRows, size)})`;
}
function chartAdaptiveHeight(layout, legacyRows, size, height) {
  if (layout !== "auto" || size !== void 0 || height !== void 0) return "";
  return legacyRows <= 6 ? "[--chart-layout-rows:6]" : "[--chart-layout-rows:6] @lg/chart:[--chart-layout-rows:10]";
}
export {
  chartAdaptiveHeight,
  chartHeightStyle,
  chartReadout,
  chartRows,
  chartSurface
};
