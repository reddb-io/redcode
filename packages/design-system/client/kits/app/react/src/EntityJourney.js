import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { StatusIndicator, quietControl } from "@reddb-io/design-system/base";
import { journeyStages } from "../../src/core/entity-journey.js";
import { entityJourney } from "../../src/entity-journey.variants.js";
function EntityJourney({
  label,
  items,
  selected = null,
  onselectedchange,
  emptyLabel = "No stages observed",
  className
}) {
  const s = entityJourney(), stages = journeyStages(items);
  return /* @__PURE__ */ jsxs("div", { "data-entity-journey": true, className: s.root({ class: className }), children: [
    /* @__PURE__ */ jsx("ol", { "aria-label": label, className: s.list(), children: stages.map((item, index) => {
      const content = /* @__PURE__ */ jsxs(Fragment, { children: [
        /* @__PURE__ */ jsx(
          "span",
          {
            "aria-hidden": "true",
            className: s.marker({ state: item.state }),
            children: index + 1
          }
        ),
        /* @__PURE__ */ jsxs("span", { className: s.body(), children: [
          /* @__PURE__ */ jsx("span", { className: s.label(), children: item.label }),
          /* @__PURE__ */ jsx(StatusIndicator, { label: item.stateLabel, tone: item.tone }),
          /* @__PURE__ */ jsx("span", { className: s.note(), children: item.description ?? "" }),
          /* @__PURE__ */ jsx("span", { className: s.elapsed(), children: item.elapsed ?? "" })
        ] })
      ] });
      return /* @__PURE__ */ jsx(
        "li",
        {
          className: s.stage(),
          "data-journey-stage": item.id,
          "data-state": item.state,
          "aria-current": item.state === "current" ? "step" : void 0,
          children: onselectedchange ? /* @__PURE__ */ jsx(
            "button",
            {
              type: "button",
              "aria-pressed": selected === item.id,
              className: quietControl({
                ink: "foreground",
                class: s.item()
              }),
              onClick: () => onselectedchange(item.id),
              children: content
            }
          ) : /* @__PURE__ */ jsx("div", { className: s.item(), children: content })
        },
        item.id
      );
    }) }),
    !stages.length && /* @__PURE__ */ jsx("p", { className: s.note(), children: emptyLabel })
  ] });
}
var EntityJourney_default = EntityJourney;
export {
  EntityJourney,
  EntityJourney_default as default
};
