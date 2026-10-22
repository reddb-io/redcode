import { createElement } from "react";
import { prose } from "../../src/prose.variants.js";
function Prose({ measure = "prose", striped = false, as = "div", className, ...rest }) {
  return createElement(as, { ...rest, "data-prose": true, "data-prose-measure": measure, className: prose({ measure, striped, class: className }) });
}
export {
  Prose
};
