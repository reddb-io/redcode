import { jsx } from "react/jsx-runtime";
import { HEATMAP_FILLS } from "../../src/chart.js";
const ordinal = (date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 864e5;
function weekStart(date) {
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  day.setDate(day.getDate() - day.getDay());
  return ordinal(day);
}
function HeatmapPlot({
  start,
  end,
  stepOf,
  width,
  height
}) {
  const days = [], date = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  if (+date < +start) date.setDate(date.getDate() + 1);
  for (; +date < +end; date.setDate(date.getDate() + 1))
    days.push(new Date(date));
  const first = weekStart(start), columns = Math.max(1, (weekStart(end) - first) / 7 + 1), cell = Math.max(0, Math.min((width - 4) / columns, (height - 4) / 7));
  return /* @__PURE__ */ jsx(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      width,
      height,
      viewBox: `0 0 ${width} ${height}`,
      "aria-hidden": "true",
      children: /* @__PURE__ */ jsx("g", { transform: "translate(2 2)", children: days.map((day) => /* @__PURE__ */ jsx(
        "rect",
        {
          x: Math.floor((ordinal(day) - first) / 7) * cell,
          y: day.getDay() * cell,
          width: cell,
          height: cell,
          fill: HEATMAP_FILLS[stepOf(day)],
          strokeWidth: 1,
          className: "lc-calendar-cell",
          "data-heatmap-step": stepOf(day)
        },
        +day
      )) })
    }
  );
}
export {
  HeatmapPlot as default
};
