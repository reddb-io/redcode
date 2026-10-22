import { jsx, jsxs } from "react/jsx-runtime";
import { sectionHeading } from "../../src/section-heading.variants.js";
function SectionHeading({ title, description, titleId, level = 2, size = "md", rule = true, actions, className, ...rest }) {
  const slots = sectionHeading({ size, rule });
  const Tag = `h${level}`;
  return /* @__PURE__ */ jsxs("div", { ...rest, "data-section-heading": true, className: slots.root({ class: className }), children: [
    /* @__PURE__ */ jsxs("div", { className: slots.text(), children: [
      /* @__PURE__ */ jsx(Tag, { id: titleId, "data-section-heading-title": true, className: slots.title(), children: title }),
      description && /* @__PURE__ */ jsx("p", { "data-section-heading-description": true, className: slots.description(), children: description })
    ] }),
    actions !== void 0 && actions !== null && /* @__PURE__ */ jsx("div", { className: slots.actions(), children: actions })
  ] });
}
export {
  SectionHeading
};
