import { unique, finite } from "../visualization.js";
import { automaticChartPalette, chartColorToken } from "./chart-color.js";
function barModel(data, series = [], sort = "input", palette) {
  unique(data, "BarChart categories");
  unique(series, "BarChart series");
  for (const item of data) for (const value of item.values ? Object.values(item.values) : [item.value]) if (value !== null && value !== void 0) finite(value, item.id);
  const total = (item) => series.length ? series.reduce((sum, s) => sum + (item.values?.[s.id] ?? 0), 0) : item.value ?? 0;
  const categories = [...data];
  if (sort !== "input") categories.sort((a, b) => (total(a) - total(b)) * (sort === "ascending" ? 1 : -1));
  const automatic = automaticChartPalette(series.length ? series : data);
  const layers = (series.length ? series : [{ id: "value", label: "Value" }]).map((s) => ({ ...s, color: series.length ? chartColorToken(s, palette, automatic) : void 0, kind: "column", data: categories.map((item) => ({ x: item.id, y: series.length ? item.values?.[s.id] ?? null : item.value ?? null, color: series.length ? void 0 : chartColorToken(item, palette, automatic) })) }));
  const labels = new Map(data.map((item) => [item.id, item.label]));
  return { categories, layers, formatX: (value) => labels.get(String(value)) ?? String(value) };
}
export {
  barModel
};
