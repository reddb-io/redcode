import { jsx, jsxs } from "react/jsx-runtime";
import { SlideFrame } from "./SlideFrame.js";
import { slideLayout } from "../../src/slide-layout.variants.js";
import { Eyebrow } from "./Eyebrow.js";
import { Heading } from "./Heading.js";
import { Text } from "./Text.js";
function FigureSlide({ title, eyebrow, figure, caption, level = 2, label, number, total, surface = "background", className, ...rest }) {
  const slots = slideLayout();
  return /* @__PURE__ */ jsx(SlideFrame, { ...rest, label: label ?? title, number, total, surface, className, "data-figure-slide": true, children: /* @__PURE__ */ jsxs("div", { className: slots.body(), children: [
    /* @__PURE__ */ jsxs("div", { className: slots.header(), children: [
      eyebrow && /* @__PURE__ */ jsx(Eyebrow, { children: eyebrow }),
      /* @__PURE__ */ jsx(Heading, { level, role: "title", children: title })
    ] }),
    /* @__PURE__ */ jsxs("figure", { "data-slide-figure": true, className: slots.figure(), children: [
      /* @__PURE__ */ jsx("div", { "data-slide-figure-body": true, className: slots.figureBody(), children: figure }),
      caption && /* @__PURE__ */ jsx("figcaption", { children: /* @__PURE__ */ jsx(Text, { role: "caption", children: caption }) })
    ] })
  ] }) });
}
export {
  FigureSlide
};
