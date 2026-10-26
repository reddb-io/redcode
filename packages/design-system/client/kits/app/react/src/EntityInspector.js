import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { createElement } from "react";
import { Button } from "@reddb-io/design-system/base";
import { inspectedEntity } from "../../src/core/entity-inspector.js";
import { entityInspector } from "../../src/entity-inspector.variants.js";
function EntityInspector({
  label,
  items,
  selected,
  context,
  onselectedchange,
  ondismiss,
  previousLabel = "Previous",
  nextLabel = "Next",
  closeLabel = "Close",
  emptyLabel = "Select an item to inspect",
  headingLevel = 2,
  children,
  actions,
  className
}) {
  const s = entityInspector(), current = inspectedEntity(items, selected);
  return /* @__PURE__ */ jsxs(
    "section",
    {
      "data-entity-inspector": true,
      "data-entity-id": current.entity?.id,
      "aria-label": label,
      className: s.root({ class: className }),
      children: [
        /* @__PURE__ */ jsxs("div", { className: s.toolbar(), children: [
          /* @__PURE__ */ jsxs("div", { className: s.navigation(), children: [
            /* @__PURE__ */ jsx(
              Button,
              {
                variant: "ghost",
                size: "sm",
                disabled: !onselectedchange || !current.previous,
                onClick: () => current.previous && onselectedchange?.(current.previous),
                children: previousLabel
              }
            ),
            /* @__PURE__ */ jsxs("span", { className: s.position(), children: [
              current.index < 0 ? 0 : current.index + 1,
              " / ",
              items.length
            ] }),
            /* @__PURE__ */ jsx(
              Button,
              {
                variant: "ghost",
                size: "sm",
                disabled: !onselectedchange || !current.next,
                onClick: () => current.next && onselectedchange?.(current.next),
                children: nextLabel
              }
            )
          ] }),
          ondismiss && /* @__PURE__ */ jsx(Button, { variant: "ghost", size: "sm", onClick: ondismiss, children: closeLabel })
        ] }),
        /* @__PURE__ */ jsx("div", { className: s.body(), children: current.entity ? /* @__PURE__ */ jsxs(Fragment, { children: [
          context && /* @__PURE__ */ jsx("p", { className: s.context(), children: context }),
          createElement(
            `h${headingLevel}`,
            { className: s.title() },
            current.entity.label
          ),
          current.entity.description && /* @__PURE__ */ jsx("p", { className: s.context(), children: current.entity.description }),
          children,
          actions && /* @__PURE__ */ jsx("div", { className: s.actions(), children: actions })
        ] }) : /* @__PURE__ */ jsx("p", { className: s.context(), children: emptyLabel }) })
      ]
    }
  );
}
var EntityInspector_default = EntityInspector;
export {
  EntityInspector,
  EntityInspector_default as default
};
