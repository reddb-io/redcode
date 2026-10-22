import { jsx, jsxs } from "react/jsx-runtime";
import { loadingIndicator } from "../../src/loading-indicator.variants.js";
function LoadingIndicator({ label = "Loading\u2026", size = "md", labelHidden = false, className, ...rest }) {
  const slots = loadingIndicator({ size, labelHidden });
  return /* @__PURE__ */ jsxs("div", { ...rest, "data-loading-indicator": true, className: slots.root({ class: className }), role: "status", "aria-live": "polite", "aria-busy": "true", children: [
    /* @__PURE__ */ jsxs("svg", { className: slots.spinner(), viewBox: "0 0 24 24", "aria-hidden": "true", children: [
      /* @__PURE__ */ jsx("circle", { className: slots.track(), cx: "12", cy: "12", r: "9", strokeWidth: "3" }),
      /* @__PURE__ */ jsx("path", { className: slots.head(), d: "M21 12a9 9 0 0 0-9-9", strokeWidth: "3", strokeLinecap: "round" })
    ] }),
    /* @__PURE__ */ jsx("span", { className: slots.label(), children: label })
  ] });
}
export {
  LoadingIndicator
};
