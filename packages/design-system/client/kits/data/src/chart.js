const CHART_ROWS = { sm: 3, md: 6, lg: 10 };
function formatChartNumber(value, fractionDigits = 2) {
  if (!Number.isFinite(value)) return "";
  const rounded = Number(value.toFixed(Math.max(0, Math.min(20, Math.floor(fractionDigits)))));
  return String(Object.is(rounded, -0) ? 0 : rounded);
}
function fractionDigitsFor(step) {
  if (!Number.isFinite(step) || step <= 0) return 2;
  return Math.max(0, Math.min(6, 1 - Math.floor(Math.log10(step))));
}
const COMFORTABLE_CHART_RHYTHM = Object.freeze({ row: 32, inset: 12 });
function observeChartRhythm(probe, update) {
  const read = () => {
    const box = probe.getBoundingClientRect();
    if (box.height > 0 && box.width > 0) update({ row: box.height, inset: box.width });
  };
  read();
  if (typeof ResizeObserver === "undefined") return () => {
  };
  const observer = new ResizeObserver(read);
  observer.observe(probe);
  return () => observer.disconnect();
}
const AXIS_TEXT_PX = 12;
const AXIS_CHARACTER_EM = 0.56;
const AXIS_TICK_ROOM_PX = 6;
const MIN_VALUE_GUTTER_PX = 24;
const CATEGORY_AXIS_GUTTER_PX = 28;
function axisLabelWidth(labels) {
  const characters = labels.reduce((widest, label) => Math.max(widest, label.length), 0);
  return Math.ceil(characters * AXIS_CHARACTER_EM * AXIS_TEXT_PX);
}
function valueAxisGutter(labels) {
  return Math.max(MIN_VALUE_GUTTER_PX, axisLabelWidth(labels) + AXIS_TICK_ROOM_PX);
}
function bandLabelCount(labels, plotWidth) {
  const slot = axisLabelWidth(labels) + AXIS_TICK_ROOM_PX;
  return Math.max(1, Math.min(labels.length, Math.floor(plotWidth / slot)));
}
const HEATMAP_FILLS = [
  "var(--reddb-color-muted)",
  "color-mix(in srgb, var(--color-primary) 25%, transparent)",
  "color-mix(in srgb, var(--color-primary) 50%, transparent)",
  "color-mix(in srgb, var(--color-primary) 75%, transparent)",
  "var(--color-primary)"
];
const HEATMAP_STEPS = HEATMAP_FILLS.length - 1;
function heatmapStep(value, maximum) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
  if (!Number.isFinite(maximum) || maximum <= 0) return 0;
  return Math.min(HEATMAP_STEPS, Math.max(1, Math.ceil(value / maximum * HEATMAP_STEPS)));
}
export {
  CATEGORY_AXIS_GUTTER_PX,
  CHART_ROWS,
  COMFORTABLE_CHART_RHYTHM,
  HEATMAP_FILLS,
  HEATMAP_STEPS,
  axisLabelWidth,
  bandLabelCount,
  formatChartNumber,
  fractionDigitsFor,
  heatmapStep,
  observeChartRhythm,
  valueAxisGutter
};
