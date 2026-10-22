import { jsx, jsxs } from "react/jsx-runtime";
import { descriptionList } from "../../src/description-list.appearance.js";
function DescriptionList({ items = [], gap = "md", className, ...rest }) {
  const slots = descriptionList({ gap });
  return /* @__PURE__ */ jsx("dl", { ...rest, "data-description-list": true, className: slots.root({ class: className }), children: items.map(
    (item, index) => /* @__PURE__ */ jsxs("div", { "data-description-item": true, className: slots.item(), children: [
      /* @__PURE__ */ jsx("dt", { className: slots.term(), children: item.term }),
      /* @__PURE__ */ jsx("dd", { className: slots.detail(), children: item.detail })
    ] }, index)
  ) });
}
export {
  DescriptionList
};
