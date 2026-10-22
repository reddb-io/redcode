import { jsx, jsxs } from "react/jsx-runtime";
import { Heading, Stack } from "@reddb-io/design-system/base";
import { pageHeading } from "../../src/composites/page-heading.variants.js";
function PageHeading({ title, description, context, actions, className, ...rest }) {
  const styles = pageHeading();
  return /* @__PURE__ */ jsxs("div", { ...rest, "data-page-heading": true, className: styles.root({ class: className }), children: [
    /* @__PURE__ */ jsxs(Stack, { gap: "sm", className: styles.identity(), children: [
      context && /* @__PURE__ */ jsx("div", { "data-page-heading-context": true, className: styles.context(), children: context }),
      /* @__PURE__ */ jsx(Heading, { level: 1, role: "title", className: styles.title(), children: title }),
      description && /* @__PURE__ */ jsx("p", { className: styles.description(), children: description })
    ] }),
    actions != null && actions !== false && /* @__PURE__ */ jsx("div", { "data-page-heading-actions": true, className: styles.actions(), children: actions })
  ] });
}
export {
  PageHeading
};
