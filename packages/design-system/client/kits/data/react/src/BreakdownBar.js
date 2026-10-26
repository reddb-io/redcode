"use client";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { Fragment as Fragment2 } from "react";
import { useControllableValue } from "@reddb-io/design-system/base";
import { quietControl } from "@reddb-io/design-system/base";
import { formatChartNumber } from "../../src/chart.js";
import {
  breakdownItems
} from "../../src/core/breakdown-bar.js";
export * from "../../src/core/breakdown-bar.js";
function BreakdownBar(props) {
  const {
    label,
    items,
    format = formatChartNumber,
    selected: initialSelected = null,
    onSelectedChange,
    className = ""
  } = props;
  const [selected, setSelected] = useControllableValue(
    props.selected,
    initialSelected,
    props.onSelectedChange
  );
  const resolved = breakdownItems(items);
  const active = resolved.some((item) => item.id === selected) ? selected : null;
  const total = resolved.reduce((sum, item) => sum + item.value, 0);
  function choose(id) {
    setSelected(id === active ? null : id);
  }
  return /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsxs(
    "div",
    {
      "data-breakdown-bar": true,
      className: `grid min-w-0 gap-[var(--reddb-spatial-gap-sm)] ${className}`,
      children: [
        /* @__PURE__ */ jsx(
          "div",
          {
            role: "img",
            "aria-label": `${label}: ${format(total)} total. ${resolved.map((item) => `${item.label} ${(item.fraction * 100).toFixed(1)}%`).join(", ")}`,
            "data-breakdown-segments": true,
            className: "flex h-[var(--reddb-spatial-control-height-sm)] overflow-hidden rounded-md bg-muted",
            children: resolved.filter((item) => item.value > 0).map((item, index) => {
              return /* @__PURE__ */ jsx(Fragment2, { children: /* @__PURE__ */ jsx(
                "span",
                {
                  "data-breakdown-segment": item.id,
                  "aria-hidden": "true",
                  className: "min-w-0 h-full border-e border-background last:border-e-0",
                  style: {
                    width: `${item.fraction * 100}%`,
                    background: item.paint,
                    opacity: active && active !== item.id ? 0.35 : 1
                  }
                }
              ) }, item.id);
            })
          }
        ),
        /* @__PURE__ */ jsxs(
          "div",
          {
            role: "group",
            "aria-label": `${label} groups`,
            className: "flex min-w-0 flex-wrap gap-x-[var(--reddb-spatial-gap-md)] gap-y-[var(--reddb-spatial-gap-sm)]",
            children: [
              resolved.map((item, index) => {
                return /* @__PURE__ */ jsx(Fragment2, { children: /* @__PURE__ */ jsxs(
                  "button",
                  {
                    type: "button",
                    "aria-pressed": active === item.id,
                    "data-breakdown-group": item.id,
                    className: quietControl({
                      ink: "foreground",
                      class: "inline-flex min-h-[var(--reddb-spatial-control-height-sm)] items-center gap-[var(--reddb-spatial-gap-sm)] border-b-2 border-transparent text-caption aria-pressed:border-foreground"
                    }),
                    onClick: () => choose(item.id),
                    children: [
                      /* @__PURE__ */ jsx(
                        "span",
                        {
                          "aria-hidden": "true",
                          className: "size-[var(--reddb-spatial-gap-md)] shrink-0 rounded-full",
                          style: { background: item.paint }
                        }
                      ),
                      item.label,
                      /* @__PURE__ */ jsx("span", { className: "text-ink-muted tabular-nums", children: format(item.value) })
                    ]
                  }
                ) }, item.id);
              }),
              active ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
                "button",
                {
                  type: "button",
                  className: quietControl({
                    class: "min-h-[var(--reddb-spatial-control-height-sm)] text-caption underline"
                  }),
                  onClick: () => choose(null),
                  children: "Show all groups"
                }
              ) }) : null,
              total === 0 ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx("p", { className: "m-0 self-center text-caption text-ink-muted", children: "No contribution in this period." }) }) : null
            ]
          }
        )
      ]
    }
  ) });
}
var BreakdownBar_default = BreakdownBar;
export {
  BreakdownBar,
  BreakdownBar_default as default
};
