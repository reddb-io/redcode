import { jsx, jsxs } from "react/jsx-runtime";
import { Fragment } from "react";
import { kbd, kbdChord } from "../../src/kbd.variants.js";
function Kbd({ keys = [], separator = "+", size = "md", className, children, ...rest }) {
  const chord = kbdChord();
  if (children !== void 0 && children !== null) return /* @__PURE__ */ jsx("kbd", { ...rest, "data-kbd": true, className: kbd({ size, class: className }), children });
  return /* @__PURE__ */ jsx("kbd", { ...rest, "data-kbd": true, className: chord.root(), children: keys.map((key, index) => /* @__PURE__ */ jsxs(Fragment, { children: [
    index > 0 && /* @__PURE__ */ jsx("span", { "aria-hidden": "true", className: chord.separator(), children: separator }),
    /* @__PURE__ */ jsx("kbd", { className: kbd({ size, class: className }), children: key })
  ] }, index)) });
}
export {
  Kbd
};
