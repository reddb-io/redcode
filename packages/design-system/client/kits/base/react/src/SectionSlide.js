import { jsx, jsxs } from "react/jsx-runtime";
import { SlideFrame } from "./SlideFrame.js";
import { slideLayout } from "../../src/slide-layout.variants.js";
import { Eyebrow } from "./Eyebrow.js";
import { Heading } from "./Heading.js";
function SectionSlide({ title, eyebrow, summary, level = 2, label, number, total, surface = "background", className, ...rest }) {
  const slots = slideLayout();
  return /* @__PURE__ */ jsx(SlideFrame, { ...rest, label: label ?? title, number, total, surface, className, "data-section-slide": true, children: /* @__PURE__ */ jsx("div", { className: slots.body(), children: /* @__PURE__ */ jsxs("div", { className: slots.header({ class: slots.centred() }), children: [
    eyebrow && /* @__PURE__ */ jsx(Eyebrow, { children: eyebrow }),
    /* @__PURE__ */ jsx(Heading, { level, role: "display", children: title }),
    summary && /* @__PURE__ */ jsx("p", { "data-slide-summary": true, className: slots.lede(), children: summary })
  ] }) }) });
}
export {
  SectionSlide
};
