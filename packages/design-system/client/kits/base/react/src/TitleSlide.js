import { jsx, jsxs } from "react/jsx-runtime";
import { SlideFrame } from "./SlideFrame.js";
import { slideLayout } from "../../src/slide-layout.variants.js";
import { Eyebrow } from "./Eyebrow.js";
import { Heading } from "./Heading.js";
import { Text } from "./Text.js";
function TitleSlide({ title, eyebrow, subtitle, presenter, level = 2, label, number, total, surface = "background", className, ...rest }) {
  const slots = slideLayout();
  return /* @__PURE__ */ jsx(SlideFrame, { ...rest, label: label ?? title, number, total, surface, className, "data-title-slide": true, children: /* @__PURE__ */ jsxs("div", { className: slots.body(), children: [
    /* @__PURE__ */ jsxs("div", { className: slots.header({ class: slots.centred() }), children: [
      eyebrow && /* @__PURE__ */ jsx(Eyebrow, { children: eyebrow }),
      /* @__PURE__ */ jsx(Heading, { level, role: "display", children: title }),
      subtitle && /* @__PURE__ */ jsx("p", { "data-slide-subtitle": true, className: slots.lede(), children: subtitle })
    ] }),
    presenter && /* @__PURE__ */ jsx(Text, { "data-slide-presenter": true, ink: "muted", className: slots.foot(), children: presenter })
  ] }) });
}
export {
  TitleSlide
};
