import { jsx, jsxs } from "react/jsx-runtime";
import { paginationSteps, validatePagination } from "../../src/core/pagination.js";
import { pagination } from "../../src/pagination.variants.js";
import { quietControl } from "../../src/quiet-control.variants.js";
import { Link } from "./Link.js";
function Pagination({ pages, label = "Pagination", onPageChange, previousLabel, nextLabel, pageCount, status, className }) {
  validatePagination(pages, onPageChange !== void 0);
  const steps = paginationSteps(pages, pageCount);
  const stepping = onPageChange !== void 0 && (previousLabel !== void 0 || nextLabel !== void 0);
  const styles = pagination({ stepped: stepping || status !== void 0 });
  const name = (item) => item.current ? `Page ${item.page}, current page` : `Go to page ${item.page}`;
  return /* @__PURE__ */ jsxs("nav", { "aria-label": label, "data-pagination": true, className: styles.root({ class: className }), children: [
    stepping && previousLabel !== void 0 && /* @__PURE__ */ jsx(
      "button",
      {
        type: "button",
        "data-pagination-previous": true,
        className: quietControl({ ink: "foreground", class: styles.page() }),
        disabled: steps.previous === null,
        onClick: () => {
          if (steps.previous !== null) onPageChange?.(steps.previous);
        },
        children: previousLabel
      }
    ),
    /* @__PURE__ */ jsx("ul", { className: styles.list(), children: pages.map((item) => /* @__PURE__ */ jsx("li", { children: onPageChange ? /* @__PURE__ */ jsx(
      "button",
      {
        type: "button",
        "aria-label": name(item),
        "aria-current": item.current ? "page" : void 0,
        className: quietControl({ ink: "foreground", class: styles.page() }),
        onClick: () => {
          if (!item.current) onPageChange(item.page);
        },
        children: item.page
      }
    ) : /* @__PURE__ */ jsx(Link, { href: item.href ?? "", "aria-label": name(item), "aria-current": item.current ? "page" : void 0, className: quietControl({ ink: "foreground", class: styles.page() }), children: item.page }) }, item.page)) }),
    stepping && nextLabel !== void 0 && /* @__PURE__ */ jsx(
      "button",
      {
        type: "button",
        "data-pagination-next": true,
        className: quietControl({ ink: "foreground", class: styles.page() }),
        disabled: steps.next === null,
        onClick: () => {
          if (steps.next !== null) onPageChange?.(steps.next);
        },
        children: nextLabel
      }
    ),
    status !== void 0 && /* @__PURE__ */ jsx("span", { "aria-live": "polite", children: status })
  ] });
}
export {
  Pagination
};
