import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { StatusIndicator, quietControl } from "@reddb-io/design-system/base";
import { uniqueEntities, stateCellWidth } from "../../src/operational.js";
import { operationalView } from "../../src/operational.variants.js";
function StateGrid({
  label,
  items,
  cellWidth = 12,
  selected = null,
  interactive = false,
  onselectedchange,
  emptyLabel = "No entities",
  className
}) {
  const s = operationalView(), cells = uniqueEntities(items, "StateGrid"), width = stateCellWidth(cellWidth);
  const content = (item) => /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsx("span", { className: s.title(), children: item.label }),
    /* @__PURE__ */ jsx(StatusIndicator, { label: item.state, tone: item.tone }),
    item.description && /* @__PURE__ */ jsx("span", { className: s.text(), children: item.description })
  ] });
  return /* @__PURE__ */ jsx("div", { "data-state-grid": true, className: s.root({ class: className }), children: cells.length ? /* @__PURE__ */ jsx(
    "ul",
    {
      "aria-label": label,
      className: s.grid(),
      style: {
        gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${width}ch), 1fr))`
      },
      children: cells.map((item) => /* @__PURE__ */ jsx(
        "li",
        {
          className: s.stateItem(),
          "data-entity-id": item.id,
          "data-state": item.state,
          children: interactive ? /* @__PURE__ */ jsx(
            "button",
            {
              type: "button",
              disabled: item.disabled,
              "aria-pressed": selected === item.id,
              onClick: () => onselectedchange?.(item.id),
              className: quietControl({
                class: [
                  s.cell(),
                  "w-full",
                  selected === item.id ? s.selected() : ""
                ].join(" ")
              }),
              children: content(item)
            }
          ) : /* @__PURE__ */ jsx("div", { className: s.cell(), children: content(item) })
        },
        item.id
      ))
    }
  ) : /* @__PURE__ */ jsx("p", { "aria-label": label, className: s.text(), children: emptyLabel }) });
}
var StateGrid_default = StateGrid;
export {
  StateGrid,
  StateGrid_default as default
};
