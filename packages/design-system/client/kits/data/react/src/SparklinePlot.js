import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { area, line, curveLinear, curveMonotoneX } from "d3-shape";
function SparklinePlot({
  strokeWidth = 2,
  data,
  curve,
  variant,
  width,
  height
}) {
  const observed = data.filter((point) => Number.isFinite(point.y)), xs = observed.map((point) => point.x), ys = observed.map((point) => point.y), w = Math.max(0, width - 4), h = Math.max(0, height - 4);
  const xDomain = variant === "bar" ? [-0.5, Math.max(0.5, data.length - 0.5)] : observed.length ? [observed[0].x, observed.at(-1).x] : [0, 1];
  let low = variant === "line" && ys.length ? Math.min(...ys) : Math.min(0, ...ys), high = variant === "line" && ys.length ? Math.max(...ys) : Math.max(0, ...ys);
  if (low === high) {
    if (variant === "line") {
      low -= 1;
      high += 1;
    } else high = low + 1;
  }
  const x = (value) => xDomain[0] === xDomain[1] ? w / 2 : (value - xDomain[0]) / (xDomain[1] - xDomain[0]) * w, y = (value) => h - (value - low) / (high - low) * h, interpolation = curve === "smooth" ? curveMonotoneX : curveLinear;
  const path = line().defined((point) => Number.isFinite(point.y)).x((point) => x(point.x)).y((point) => y(point.y)).curve(interpolation)(data);
  const fill = variant === "area" ? area().defined((point) => Number.isFinite(point.y)).x((point) => x(point.x)).y0(y(0)).y1((point) => y(point.y)).curve(interpolation)(data) : null;
  return /* @__PURE__ */ jsx(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      width,
      height,
      viewBox: `0 0 ${width} ${height}`,
      "aria-hidden": "true",
      pointerEvents: "none",
      children: /* @__PURE__ */ jsx("g", { transform: "translate(2 2)", children: variant === "bar" ? observed.map((point) => /* @__PURE__ */ jsx(
        "rect",
        {
          "data-sparkline-column": true,
          x: x(point.x - 0.36),
          y: Math.min(y(0), y(point.y)),
          width: x(point.x + 0.36) - x(point.x - 0.36),
          height: Math.abs(y(point.y) - y(0)),
          fill: "var(--color-primary)"
        },
        point.x
      )) : /* @__PURE__ */ jsxs(Fragment, { children: [
        fill && /* @__PURE__ */ jsx(
          "path",
          {
            "data-sparkline-area": true,
            d: fill,
            fill: "var(--color-primary)",
            fillOpacity: 0.25
          }
        ),
        path && /* @__PURE__ */ jsx(
          "path",
          {
            d: path,
            fill: "none",
            stroke: "var(--color-primary)",
            strokeWidth
          }
        )
      ] }) })
    }
  );
}
export {
  SparklinePlot as default
};
