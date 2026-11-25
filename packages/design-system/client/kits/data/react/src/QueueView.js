import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { Alert, Button, ContentState, LoadingIndicator, StatusIndicator, collectionView, quietControl } from "@reddb-io/design-system/base";
import { uniqueEntities } from "../../src/operational.js";
import { operationalView } from "../../src/operational.variants.js";
function QueueView({
  label,
  slots,
  selected = null,
  interactive = false,
  onselectedchange,
  emptyLabel = "Empty slot",
  state,
  errorMessage = "Could not load the queue.",
  retryLabel = "Retry",
  loadingRows = 5,
  onretry,
  className
}) {
  const visual = operationalView(), view = collectionView(state, slots.length);
  return /* @__PURE__ */ jsxs(
    "section",
    {
      "data-queue-view": true,
      "data-state": state ?? "ready",
      "aria-busy": view.busy ? true : void 0,
      "aria-label": label,
      className: visual.root({ class: className }),
      children: [
        /* @__PURE__ */ jsx("p", { className: visual.title(), children: label }),
        state === "refreshing" && !view.placeholder && /* @__PURE__ */ jsx(LoadingIndicator, { size: "sm", label: "Refreshing" }),
        view.stale && /* @__PURE__ */ jsxs(Alert, { tone: "danger", children: [
          errorMessage,
          onretry && /* @__PURE__ */ jsxs(Fragment, { children: [
            " ",
            /* @__PURE__ */ jsx(Button, { size: "sm", variant: "secondary", onClick: onretry, children: retryLabel })
          ] })
        ] }),
        view.placeholder ? /* @__PURE__ */ jsx(ContentState, { state: view.placeholder, label, emptyTitle: "No slots", errorMessage, retryLabel, onRetry: onretry, shape: "list", rows: loadingRows, children: /* @__PURE__ */ jsx("span", {}) }) : /* @__PURE__ */ jsx("ol", { className: visual.queue(), children: uniqueEntities(slots, "QueueView").map((slot) => /* @__PURE__ */ jsx(
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
