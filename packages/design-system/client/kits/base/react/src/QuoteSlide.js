import { jsx, jsxs } from "react/jsx-runtime";
import { SlideFrame } from "./SlideFrame.js";
import { slideLayout } from "../../src/slide-layout.variants.js";
import { Text } from "./Text.js";
function QuoteSlide({ quote, attribution, source, label, number, total, surface = "background", className, ...rest }) {
  const slots = slideLayout();
  return /* @__PURE__ */ jsx(SlideFrame, { ...rest, label: label ?? `Quote from ${attribution}`, number, total, surface, className, "data-quote-slide": true, children: /* @__PURE__ */ jsx("div", { className: slots.body(), children: /* @__PURE__ */ jsxs("figure", { "data-slide-quote": true, className: slots.quote(), children: [
    /* @__PURE__ */ jsx("blockquote", { children: /* @__PURE__ */ jsxs("p", { className: slots.quoteText(), children: [
      "\u201C",
      quote,
      "\u201D"
    ] }) }),
    /* @__PURE__ */ jsxs("figcaption", { children: [
      /* @__PURE__ */ jsx(Text, { as: "span", children: attribution }),
      source && /* @__PURE__ */ jsxs(Text, { as: "span", ink: "muted", children: [
        ", ",
        source
      ] })
    ] })
  ] }) }) });
}
export {
  QuoteSlide
};
