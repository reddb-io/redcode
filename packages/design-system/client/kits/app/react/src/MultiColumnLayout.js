import { jsx, jsxs } from "react/jsx-runtime";
import { Stack } from "@reddb-io/design-system/base";
import { multiColumnLayout } from "../../src/composites/multi-column-layout.variants.js";
function MultiColumnLayout({ start, children, end, gap = "layout-md", className, ...rest }) {
  const columns = end ? "three" : "two", styles = multiColumnLayout({ columns });
  return /* @__PURE__ */ jsxs("div", { ...rest, "data-multi-column-layout": true, "data-columns": columns, className: styles.root({ class: className }), children: [
    /* @__PURE__ */ jsx(Stack, { gap, className: styles.column({ class: styles.start() }), "data-column": "start", children: start }),
    /* @__PURE__ */ jsx(Stack, { gap, className: styles.column({ class: styles.main() }), "data-column": "main", children }),
    end != null && end !== false && /* @__PURE__ */ jsx(Stack, { gap, className: styles.column({ class: styles.end() }), "data-column": "end", children: end })
  ] });
}
export {
  MultiColumnLayout
};
