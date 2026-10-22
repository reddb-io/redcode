import { jsx, jsxs } from "react/jsx-runtime";
import { slideFrame } from "../../src/slide-frame.variants.js";
function SlideFrame({ label, number, total, surface = "background", className, children, ...rest }) {
  const slots = slideFrame({ surface });
  const position = total === void 0 ? `Slide ${number}` : `Slide ${number} of ${total}`;
  const glyphs = total === void 0 ? `${number}` : `${number} / ${total}`;
  return /* @__PURE__ */ jsx(
    "div",
    {
      ...rest,
      role: "group",
      "aria-roledescription": "slide",
      "aria-label": label,
      "data-slide-frame": true,
      "data-slide-surface": surface,
      "data-slide-number": number,
      "data-slide-total": total,
      className: slots.root({ class: className }),
      children: /* @__PURE__ */ jsxs("div", { "data-slide-stage": true, className: slots.stage(), children: [
        /* @__PURE__ */ jsx("div", { "data-slide-safe-area": true, className: slots.safeArea(), children }),
        number !== void 0 && /* @__PURE__ */ jsxs("p", { "data-slide-number-label": true, className: slots.number(), children: [
          /* @__PURE__ */ jsx("span", { className: "sr-only", children: position }),
          /* @__PURE__ */ jsx("span", { "aria-hidden": "true", children: glyphs })
        ] })
      ] })
    }
  );
}
export {
  SlideFrame
};
