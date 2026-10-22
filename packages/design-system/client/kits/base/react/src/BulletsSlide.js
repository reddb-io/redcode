import { jsx, jsxs } from "react/jsx-runtime";
import { SlideFrame } from "./SlideFrame.js";
import { slideLayout } from "../../src/slide-layout.variants.js";
import { Eyebrow } from "./Eyebrow.js";
import { Heading } from "./Heading.js";
function BulletsSlide({ title, items, eyebrow, level = 2, label, number, total, surface = "background", className, ...rest }) {
  const slots = slideLayout();
  return /* @__PURE__ */ jsx(SlideFrame, { ...rest, label: label ?? title, number, total, surface, className, "data-bullets-slide": true, children: /* @__PURE__ */ jsxs("div", { className: slots.body(), children: [
    /* @__PURE__ */ jsxs("div", { className: slots.header(), children: [
      eyebrow && /* @__PURE__ */ jsx(Eyebrow, { children: eyebrow }),
      /* @__PURE__ */ jsx(Heading, { level, role: "title", children: title })
    ] }),
    /* @__PURE__ */ jsx("ul", { "data-slide-points": true, className: slots.list(), children: items.map((item, index) => /* @__PURE__ */ jsx("li", { className: slots.item(), children: item }, index)) })
  ] }) });
}
export {
  BulletsSlide
};
