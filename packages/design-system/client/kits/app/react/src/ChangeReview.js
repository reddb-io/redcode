import { jsx, jsxs } from "react/jsx-runtime";
import { createElement } from "react";
import { Button, StatusIndicator } from "@reddb-io/design-system/base";
import { changeReview } from "../../src/change-review.variants.js";
import { reviewChanges } from "../../src/core/change-review.js";
function ChangeReview({
  title,
  items,
  applying = false,
  blockedReason,
  onapplyrequest,
  ondiscardrequest,
  beforeLabel = "Before",
  afterLabel = "After",
  applyLabel = "Apply changes",
  discardLabel = "Discard all",
  discardItemLabel = "Discard",
  emptyLabel = "No pending changes",
  pendingLabel = "Pending",
  applyingLabel = "Applying",
  appliedLabel = "Applied",
  failedLabel = "Failed",
  headingLevel = 2,
  className
}) {
  const s = changeReview(), review = reviewChanges(items), busy = applying || review.applying;
  const states = {
    pending: pendingLabel,
    applying: applyingLabel,
    applied: appliedLabel,
    failed: failedLabel
  };
  return /* @__PURE__ */ jsxs(
    "section",
    {
      "data-change-review": true,
      "aria-label": title,
      "aria-busy": busy,
      className: s.root({ class: className }),
      children: [
        createElement(`h${headingLevel}`, { className: s.title() }, title),
        /* @__PURE__ */ jsx("ol", { className: s.list(), children: review.items.map((item) => /* @__PURE__ */ jsxs(
          "li",
          {
            "data-review-change": item.id,
            "data-state": item.state ?? "pending",
            className: s.item(),
            children: [
              /* @__PURE__ */ jsxs("div", { className: s.header(), children: [
                /* @__PURE__ */ jsx("span", { className: s.name(), children: item.label }),
                /* @__PURE__ */ jsx(
                  StatusIndicator,
                  {
                    label: states[item.state ?? "pending"],
                    tone: item.state === "failed" ? "danger" : item.state === "applied" ? "success" : "neutral"
                  }
                ),
                ondiscardrequest && item.state !== "applied" && /* @__PURE__ */ jsx(
                  Button,
                  {
                    variant: "ghost",
                    size: "sm",
                    disabled: busy,
                    "aria-label": `${discardItemLabel} ${item.label}`,
                    onClick: () => ondiscardrequest([item.id]),
                    children: discardItemLabel
                  }
                )
              ] }),
              item.description && /* @__PURE__ */ jsx("p", { className: s.context(), children: item.description }),
              /* @__PURE__ */ jsxs("dl", { className: s.comparison(), children: [
                /* @__PURE__ */ jsxs("div", { className: s.pair(), children: [
                  /* @__PURE__ */ jsx("dt", { className: s.term(), children: beforeLabel }),
                  /* @__PURE__ */ jsx("dd", { className: s.value(), children: item.before })
                ] }),
                /* @__PURE__ */ jsxs("div", { className: s.pair(), children: [
                  /* @__PURE__ */ jsx("dt", { className: s.term(), children: afterLabel }),
                  /* @__PURE__ */ jsx("dd", { className: s.value(), children: item.after })
                ] })
              ] }),
              item.error && /* @__PURE__ */ jsx("p", { role: "alert", className: s.error(), children: item.error })
            ]
          },
          item.id
        )) }),
        !items.length && /* @__PURE__ */ jsx("p", { className: s.context(), children: emptyLabel }),
        blockedReason && /* @__PURE__ */ jsx("p", { className: s.context(), children: blockedReason }),
        (onapplyrequest || ondiscardrequest) && /* @__PURE__ */ jsxs("div", { className: s.actions(), children: [
          ondiscardrequest && /* @__PURE__ */ jsx(
            Button,
            {
              variant: "ghost",
              disabled: busy || !review.actionable.length,
              onClick: () => ondiscardrequest([...review.actionable]),
              children: discardLabel
            }
          ),
          onapplyrequest && /* @__PURE__ */ jsx(
            Button,
            {
              disabled: busy || !!blockedReason || !review.actionable.length,
              loading: busy,
              onClick: () => onapplyrequest([...review.actionable]),
              children: applyLabel
            }
          )
        ] })
      ]
    }
  );
}
var ChangeReview_default = ChangeReview;
export {
  ChangeReview,
  ChangeReview_default as default
};
