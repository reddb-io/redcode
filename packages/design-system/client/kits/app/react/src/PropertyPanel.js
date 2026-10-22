import { jsx, jsxs } from "react/jsx-runtime";
import { DescriptionList } from "@reddb-io/design-system/base";
import { operational } from "../../src/operational.variants.js";
function PropertyPanel({
  title,
  items,
  description,
  actions,
  className
}) {
  const s = operational();
  return /* @__PURE__ */ jsxs(
    "section",
    {
      "data-property-panel": true,
      "aria-label": title,
      className: [s.root({ class: className }), s.body()].join(" "),
      children: [
        /* @__PURE__ */ jsxs("div", { className: s.header(), children: [
          /* @__PURE__ */ jsx("p", { className: s.title(), children: title }),
          actions && /* @__PURE__ */ jsx("div", { className: s.actions(), children: actions })
        ] }),
        description && /* @__PURE__ */ jsx("p", { className: s.description(), children: description }),
        /* @__PURE__ */ jsx(
          DescriptionList,
          {
            gap: "sm",
            className: s.properties(),
            items: items.map((item) => ({
              term: item.label,
              detail: String(item.value)
            }))
          }
        )
      ]
    }
  );
}
export {
  PropertyPanel
};
