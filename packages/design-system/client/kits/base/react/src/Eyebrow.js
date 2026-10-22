import { createElement } from "react";
import { eyebrow } from "../../src/eyebrow.variants.js";
function Eyebrow({ as = "p", className, ...rest }) {
  return createElement(as, { ...rest, "data-eyebrow": true, "data-type-role": "eyebrow", className: eyebrow({ class: className }) });
}
export {
  Eyebrow
};
