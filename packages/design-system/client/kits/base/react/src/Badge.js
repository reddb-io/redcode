import { jsx } from "react/jsx-runtime";
import { badge } from "../../src/badge.variants.js";
function Badge({ tone = "neutral", variant = "tinted", className, ...rest }) {
  return /* @__PURE__ */ jsx("span", { ...rest, "data-badge": true, "data-tone": tone, "data-variant": variant, className: badge({ tone, variant, class: className }) });
}
export {
  Badge
};
