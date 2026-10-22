import { jsx } from "react/jsx-runtime";
import { deck } from "../../src/deck.variants.js";
function Deck({ label, className, children, ...rest }) {
  return /* @__PURE__ */ jsx("section", { ...rest, "aria-label": label, "data-deck": true, className: deck({ class: className }), children });
}
export {
  Deck
};
