import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { quietControl } from "@reddb-io/design-system/base";
import { statusCounts } from "../../src/core/status-breakdown.js";
import { statusBreakdown } from "../../src/status-breakdown.variants.js";
function StatusBreakdown({
  label,
  items,
  selected = null,
  interactive = false,
  onselectedchange,
  emptyLabel = "No items",
  className
}) {
  const s = statusBreakdown(), resolved = statusCounts(items);
  return /* @__PURE__ */ jsxs(
    "section",
    {
      "data-status-breakdown": true,
      "aria-label": label,
      className: s.root({ class: className }),
      children: [
        /* @__PURE__ */ jsxs("p", { className: s.heading(), children: [
          label,
          /* @__PURE__ */ jsxs("span", { className: s.total(), children: [
            resolved.total,
            " total"
          ] })
        ] }),
        /* @__PURE__ */ jsx("div", { "aria-hidden": "true", className: s.track(), children: resolved.items.filter((item) => item.count > 0).map((item) => /* @__PURE__ */ jsx(
          "span",
          {
            "data-status-segment": item.id,
            className: s.segment(),
            style: {
              width: `${item.fraction * 100}%`,
              background: item.paint
            }
          },
          item.id
        )) }),
        /* @__PURE__ */ jsx("ul", { "aria-label": `${label} states`, className: s.list(), children: resolved.items.map((item) => {
          const content = /* @__PURE__ */ jsxs(Fragment, { children: [
            /* @__PURE__ */ jsx(
              "span",
              {
                "aria-hidden": "true",
                className: s.swatch(),
                style: { background: item.paint }
              }
            ),
            /* @__PURE__ */ jsx("span", { children: item.label }),
            /* @__PURE__ */ jsx("span", { className: s.count(), children: item.count })
          ] });
          return /* @__PURE__ */ jsx("li", { children: interactive ? /* @__PURE__ */ jsx(
            "button",
            {
              type: "button",
              "data-status-filter": item.id,
              "aria-pressed": selected === item.id,
              className: quietControl({
                ink: "foreground",
                class: s.item()
              }),
              onClick: () => onselectedchange?.(selected === item.id ? null : item.id),
              children: content
            }
          ) : /* @__PURE__ */ jsx("span", { className: s.item(), children: content }) }, item.id);
        }) }),
        resolved.total === 0 && /* @__PURE__ */ jsx("p", { className: s.empty(), children: emptyLabel })
      ]
    }
  );
}
var StatusBreakdown_default = StatusBreakdown;
export {
  StatusBreakdown,
  StatusBreakdown_default as default
};
