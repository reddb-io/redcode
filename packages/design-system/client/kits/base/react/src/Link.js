import { jsx } from "react/jsx-runtime";
import { link } from "../../src/link.variants.js";
function Link({ href, className, children, ...rest }) {
  return /* @__PURE__ */ jsx("a", { ...rest, href, "data-link": true, className: link({ class: className }), children });
}
export {
  Link
};
