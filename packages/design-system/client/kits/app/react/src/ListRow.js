import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { quietControl } from "@reddb-io/design-system/base";
import { listRow } from "../../src/primitives/list-row.variants.js";
function ListRow({ title, description, href, size, selected = false, leading, trailing, children, className, ...rest }) {
  const interactive = href !== void 0 || !!rest.onClick, styles = listRow({ size: size ?? "md", interactive, selected });
  const content = /* @__PURE__ */ jsxs(Fragment, { children: [
    leading != null && leading !== false && /* @__PURE__ */ jsx("span", { className: styles.leading(), children: leading }),
    /* @__PURE__ */ jsx("span", { className: styles.text(), children: children ?? /* @__PURE__ */ jsxs(Fragment, { children: [
      title && /* @__PURE__ */ jsx("span", { className: styles.title(), children: title }),
      description && /* @__PURE__ */ jsx("span", { className: styles.description(), children: description })
    ] }) }),
    trailing != null && trailing !== false && /* @__PURE__ */ jsx("span", { className: styles.trailing(), children: trailing })
  ] });
  if (href !== void 0) return /* @__PURE__ */ jsx("a", { ...rest, href, "data-size": size ?? "md", "aria-current": selected ? "true" : void 0, className: quietControl({ ink: "inherit", selected, class: styles.root({ class: className }) }), children: content });
  if (rest.onClick) return /* @__PURE__ */ jsx("button", { ...rest, type: "button", "data-size": size ?? "md", className: quietControl({ ink: "inherit", selected, class: styles.root({ class: className }) }), children: content });
  return /* @__PURE__ */ jsx("div", { ...rest, "data-size": size ?? "md", className: styles.root({ class: className }), children: content });
}
export {
  ListRow
};
