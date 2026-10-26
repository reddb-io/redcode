import { jsx, jsxs } from "react/jsx-runtime";
function ChartCanvas({
  width,
  height,
  label,
  padding = 0,
  children
}) {
  const p = typeof padding === "number" ? { top: padding, right: padding, bottom: padding, left: padding } : padding;
  return /* @__PURE__ */ jsxs(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      width,
      height,
      viewBox: `0 0 ${width} ${height}`,
      role: "group",
      "aria-label": label,
      children: [
        /* @__PURE__ */ jsx("title", { children: label }),
        /* @__PURE__ */ jsx("g", { transform: `translate(${p.left} ${p.top})`, children })
      ]
    }
  );
}
export {
  ChartCanvas as default
};
