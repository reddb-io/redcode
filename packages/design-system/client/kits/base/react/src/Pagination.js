import { jsx } from "react/jsx-runtime";
import { pagination } from "../../src/pagination.variants.js";
import { quietControl } from "../../src/quiet-control.variants.js";
import { Link } from "./Link.js";
function Pagination({ pages, label = "Pagination", className }) {
  const styles = pagination();
  return /* @__PURE__ */ jsx("nav", { "aria-label": label, "data-pagination": true, className: styles.root({ class: className }), children: /* @__PURE__ */ jsx("ul", { className: styles.list(), children: pages.map((item) => /* @__PURE__ */ jsx("li", { children: /* @__PURE__ */ jsx(Link, { href: item.href, "aria-label": item.current ? `Page ${item.page}, current page` : `Go to page ${item.page}`, "aria-current": item.current ? "page" : void 0, className: quietControl({ ink: "foreground", class: styles.page() }), children: item.page }) }, item.page)) }) });
}
export {
  Pagination
};
