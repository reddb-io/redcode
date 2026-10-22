import { jsx, jsxs } from "react/jsx-runtime";
import { SlideFrame } from "./SlideFrame.js";
import { slideLayout } from "../../src/slide-layout.variants.js";
import { Eyebrow } from "./Eyebrow.js";
import { Heading } from "./Heading.js";
function TwoColumnSlide({ title, eyebrow, start, end, level = 2, label, number, total, surface = "background", className, ...rest }) {
  const slots = slideLayout();
  return /* @__PURE__ */ jsx(SlideFrame, { ...rest, label: label ?? title, number, total, surface, className, "data-two-column-slide": true, children: /* @__PURE__ */ jsxs("div", { className: slots.body(), children: [
    /* @__PURE__ */ jsxs("div", { className: slots.header(), children: [
      eyebrow && /* @__PURE__ */ jsx(Eyebrow, { children: eyebrow }),
      /* @__PURE__ */ jsx(Heading, { level, role: "title", children: title })
    ] }),
    /* @__PURE__ */ jsxs("div", { "data-slide-columns": true, className: slots.columns(), children: [
      /* @__PURE__ */ jsx("div", { "data-slide-column": "start", className: slots.column(), children: start }),
      /* @__PURE__ */ jsx("div", { "data-slide-column": "end", className: slots.column(), children: end })
    ] })
  ] }) });
}
export {
  TwoColumnSlide
};
