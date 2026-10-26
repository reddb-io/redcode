import { jsx, jsxs } from "react/jsx-runtime";
import { StatusIndicator, quietControl } from "@reddb-io/design-system/base";
import { uniqueEntities } from "../../src/operational.js";
import { operationalView } from "../../src/operational.variants.js";
function QueueView({
  label,
  slots,
  selected = null,
  interactive = false,
  onselectedchange,
  emptyLabel = "Empty slot",
  className
}) {
  const visual = operationalView();
  return /* @__PURE__ */ jsxs(
    "section",
    {
      "data-queue-view": true,
      "aria-label": label,
      className: visual.root({ class: className }),
      children: [
        /* @__PURE__ */ jsx("p", { className: visual.title(), children: label }),
        /* @__PURE__ */ jsx("ol", { className: visual.queue(), children: uniqueEntities(slots, "QueueView").map((slot) => /* @__PURE__ */ jsx(
          "li",
          {
            className: visual.queueSlot(),
            "data-slot-id": slot.id,
            children: interactive && slot.item ? /* @__PURE__ */ jsxs(
              "button",
              {
                type: "button",
                className: quietControl({
                  class: [
                    visual.cell(),
                    "w-full",
                    selected === slot.item.id ? visual.selected() : ""
                  ].join(" ")
                }),
                "aria-pressed": selected === slot.item.id,
                disabled: slot.item.disabled,
                onClick: () => onselectedchange?.(slot.item.id),
                children: [
                  /* @__PURE__ */ jsx("span", { className: visual.text(), children: slot.label }),
                  /* @__PURE__ */ jsx("span", { className: visual.title(), children: slot.item.label }),
                  /* @__PURE__ */ jsx(
                    StatusIndicator,
                    {
                      label: slot.item.state,
                      tone: slot.item.tone
                    }
                  )
                ]
              }
            ) : /* @__PURE__ */ jsxs("div", { className: visual.cell(), children: [
              /* @__PURE__ */ jsx("span", { className: visual.text(), children: slot.label }),
              /* @__PURE__ */ jsx("span", { className: visual.title(), children: slot.item?.label ?? emptyLabel }),
              slot.item && /* @__PURE__ */ jsx(
                StatusIndicator,
                {
                  label: slot.item.state,
                  tone: slot.item.tone
                }
              )
            ] })
          },
          slot.id
        )) })
      ]
    }
  );
}
var QueueView_default = QueueView;
export {
  QueueView,
  QueueView_default as default
};
