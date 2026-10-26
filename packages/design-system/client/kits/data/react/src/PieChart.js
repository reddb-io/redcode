"use client";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { Button, Dialog, quietControl, useControllableValue } from "@reddb-io/design-system/base";
import { circularModel } from "../../src/core/circular-chart.js";
import { number } from "../../src/visualization.js";
import { compositeChart } from "../../src/composite-chart.variants.js";
import { circularChart } from "../../src/circular-chart.variants.js";
import { chartHeightStyle } from "../../src/chart-layout.variants.js";
import Plot from "./CircularPlot.js";
function PieChart(props) {
  const { selected: initialSelected = null, expanded: initialExpanded = false, data, label, description, palette, interactive = true, format = number, legend = "compact", labels = "none", layout = "roomy", size, height, expandable = true, className } = props;
  const [selected, setSelected] = useControllableValue(props.selected, initialSelected, props.onSelectedChange);
  const [expanded, setExpanded] = useControllableValue(props.expanded, initialExpanded, props.onExpandedChange);
  const model = circularModel(data, void 0, selected, palette), styles = circularChart();
  const choose = (id) => setSelected(selected === id ? null : id);
  const plot = (fill = false) => /* @__PURE__ */ jsx(Plot, { data, label, selected, palette, labels, format, height: fill ? "100%" : chartHeightStyle(layout, 10, size, height) ?? "100%", onSelect: interactive ? choose : void 0 });
  const legendContent = legend === "compact" && /* @__PURE__ */ jsx("div", { "aria-label": `${label} groups`, className: styles.legend(), children: model.slices.map((slice) => /* @__PURE__ */ jsxs("button", { type: "button", disabled: !interactive, "aria-pressed": selected === slice.id, "data-circular-legend": slice.id, className: quietControl({ ink: "foreground", class: styles.item() }), onClick: () => choose(slice.id), children: [
    /* @__PURE__ */ jsx("span", { "aria-hidden": "true", className: styles.swatch(), style: { background: slice.paint } }),
    slice.label,
    " ",
    /* @__PURE__ */ jsx("span", { className: "tabular-nums", children: format(slice.value) })
  ] }, slice.id)) });
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsxs("figure", { "data-circular-chart": "PieChart", "aria-label": label, className: styles.root({ class: `${height === "fill" ? "h-full" : ""} ${className ?? ""}` }), children: [
      /* @__PURE__ */ jsxs("figcaption", { className: styles.toolbar(), children: [
        /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx("p", { className: "text-caption font-medium", children: label }),
          description && /* @__PURE__ */ jsx("p", { className: "text-caption text-ink-muted", children: description })
        ] }),
        expandable && interactive && /* @__PURE__ */ jsx(Button, { size: "sm", variant: "ghost", onClick: () => setExpanded(true), children: "Maximize" })
      ] }),
      plot(),
      legendContent,
      /* @__PURE__ */ jsxs("details", { className: "text-caption", children: [
        /* @__PURE__ */ jsxs("summary", { children: [
          "Explore data (",
          data.length,
          ")"
        ] }),
        /* @__PURE__ */ jsxs("table", { className: "w-full text-start", children: [
          /* @__PURE__ */ jsxs("caption", { className: "sr-only", children: [
            label,
            " data"
          ] }),
          /* @__PURE__ */ jsx("thead", { children: /* @__PURE__ */ jsxs("tr", { children: [
            /* @__PURE__ */ jsx("th", { scope: "col", children: "Item" }),
            /* @__PURE__ */ jsx("th", { scope: "col", children: "Value" }),
            /* @__PURE__ */ jsx("th", { scope: "col", children: "Share" })
          ] }) }),
          /* @__PURE__ */ jsx("tbody", { children: model.slices.map((slice) => /* @__PURE__ */ jsxs("tr", { children: [
            /* @__PURE__ */ jsx("th", { scope: "row", children: slice.label }),
            /* @__PURE__ */ jsx("td", { children: format(slice.value) }),
            /* @__PURE__ */ jsxs("td", { children: [
              (slice.fraction * 100).toFixed(1),
              "%"
            ] })
          ] }, slice.id)) })
        ] })
      ] })
    ] }),
    /* @__PURE__ */ jsx(Dialog, { title: label, size: "xl", open: expanded, onOpenChange: setExpanded, className: compositeChart().dialog(), header: ({ close }) => /* @__PURE__ */ jsxs("div", { className: compositeChart().header(), children: [
      /* @__PURE__ */ jsx("span", { className: "text-caption font-medium", children: label }),
      /* @__PURE__ */ jsx(Button, { size: "sm", variant: "ghost", onClick: close, children: "Restore" })
    ] }), children: expanded && /* @__PURE__ */ jsxs("div", { className: "flex h-full min-h-0 flex-col", children: [
      plot(true),
      legendContent
    ] }) })
  ] });
}
var PieChart_default = PieChart;
export {
  PieChart,
  PieChart_default as default
};
