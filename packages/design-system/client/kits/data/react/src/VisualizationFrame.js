"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import {
  useLayoutEffect,
  useRef,
  useState
} from "react";
import { visualizationControls } from "../../src/visualization-controls.variants.js";
import { quietControl } from "@reddb-io/design-system/base";
import {
  seriesColor
} from "../../src/visualization.js";
function VisualizationFrame({
  label,
  description,
  kind,
  width,
  height,
  widthUnits,
  heightUnits,
  size = "lg",
  rows = [],
  legend = [],
  selected,
  onSelect,
  detailHref,
  className = "",
  children
}) {
  const controls = visualizationControls();
  const probe = useRef(null), drawing = useRef(null), [box, setBox] = useState({ unit: 0, width: 0, height: 0 }), count = { sm: 6, md: 10, lg: 14 };
  useLayoutEffect(() => {
    const measure = () => {
      const unit = probe.current?.getBoundingClientRect().height ?? 0, rect = drawing.current?.getBoundingClientRect();
      setBox(
        (previous) => previous.unit === unit && previous.width === (rect?.width ?? 0) && previous.height === (rect?.height ?? 0) ? previous : { unit, width: rect?.width ?? 0, height: rect?.height ?? 0 }
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    if (probe.current) observer.observe(probe.current);
    if (drawing.current) observer.observe(drawing.current);
    return () => observer.disconnect();
  }, []);
  const w = width ?? Math.max(
    widthUnits === void 0 ? 480 : widthUnits * (box.unit || 32),
    box.width || 800
  ), h = height ?? (box.height || (heightUnits ?? count[size]) * 32);
  return /* @__PURE__ */ jsxs(
    "figure",
    {
      "data-visualization": kind,
      className: `relative m-0 flex w-full min-w-0 flex-col gap-[var(--reddb-spatial-gap-md)] text-foreground ${className}`,
      children: [
        /* @__PURE__ */ jsxs("figcaption", { className: "flex flex-wrap items-start justify-between gap-[var(--reddb-spatial-gap-sm)]", children: [
          /* @__PURE__ */ jsxs("div", { className: "min-w-0", children: [
            /* @__PURE__ */ jsx("p", { className: "m-0 text-sm font-medium", children: label }),
            description && /* @__PURE__ */ jsx("p", { className: "m-0 mt-[var(--reddb-spatial-gap-sm)] max-w-prose text-xs text-ink-muted", children: description })
          ] }),
          detailHref && /* @__PURE__ */ jsx(
            "a",
            {
              href: detailHref,
              className: quietControl({
                class: "text-xs text-foreground underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              }),
              children: "Explore"
            }
          )
        ] }),
        /* @__PURE__ */ jsx(
          "span",
          {
            ref: probe,
            "aria-hidden": "true",
            className: "pointer-events-none invisible absolute h-[var(--reddb-spatial-control-height-md)] w-[var(--reddb-spatial-inset-sm)]"
          }
        ),
        /* @__PURE__ */ jsx(
          "div",
          {
            className: "min-w-0 overflow-x-auto",
            tabIndex: 0,
            role: "region",
            "aria-label": `${label} visualization`,
            children: /* @__PURE__ */ jsx(
              "div",
              {
                ref: drawing,
                className: "min-w-[calc(var(--reddb-spatial-control-height-md)*15)]",
                style: {
                  minWidth: widthUnits === void 0 ? void 0 : `calc(var(--reddb-spatial-control-height-md) * ${widthUnits})`,
                  width: width === void 0 ? void 0 : `${width}px`,
                  height: height === void 0 ? `calc(var(--reddb-spatial-control-height-md) * ${heightUnits ?? count[size]})` : `${height}px`
                },
                children: children({ width: w, height: h, unit: box.unit || 32 })
              }
            )
          }
        ),
        legend.length > 0 && /* @__PURE__ */ jsx(
          "ul",
          {
            "aria-label": `${label} legend`,
            className: "m-0 flex list-none flex-wrap gap-[var(--reddb-spatial-gap-md)] p-0 text-xs",
            children: legend.map((item) => /* @__PURE__ */ jsxs(
              "li",
              {
                className: "flex items-center gap-[var(--reddb-spatial-gap-sm)]",
                children: [
                  /* @__PURE__ */ jsx(
                    "span",
                    {
                      "aria-hidden": "true",
                      className: "inline-block h-[var(--reddb-spatial-icon-size-sm)] w-[var(--reddb-spatial-icon-size-sm)] rounded-full",
                      style: { background: seriesColor(item.series) }
                    }
                  ),
                  onSelect ? /* @__PURE__ */ jsx(
                    "button",
                    {
                      type: "button",
                      className: quietControl({ class: controls.action({ class: "cursor-pointer" }) }),
                      "aria-pressed": selected === item.id,
                      onClick: () => onSelect(item.id),
                      children: item.label
                    }
                  ) : item.label
                ]
              },
              item.id
            ))
          }
        ),
        rows.length > 0 ? /* @__PURE__ */ jsxs("details", { className: "text-xs", children: [
          /* @__PURE__ */ jsxs("summary", { className: controls.summary({ class: "w-fit cursor-pointer text-ink-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus" }), children: [
            "Explore data (",
            rows.length,
            ")"
          ] }),
          /* @__PURE__ */ jsx(
            "div",
            {
              className: "mt-[var(--reddb-spatial-gap-sm)] overflow-auto",
              style: {
                maxHeight: "calc(var(--reddb-spatial-control-height-md) * 8)"
              },
              children: /* @__PURE__ */ jsxs("table", { className: "w-full border-collapse text-start text-xs", children: [
                /* @__PURE__ */ jsxs("caption", { className: "sr-only", children: [
                  label,
                  " data"
                ] }),
                /* @__PURE__ */ jsx("thead", { children: /* @__PURE__ */ jsxs("tr", { className: "border-b border-muted text-ink-muted", children: [
                  /* @__PURE__ */ jsx(
                    "th",
                    {
                      scope: "col",
                      className: "p-[var(--reddb-spatial-inset-sm)] text-start font-medium",
                      children: "Item"
                    }
                  ),
                  /* @__PURE__ */ jsx(
                    "th",
                    {
                      scope: "col",
                      className: "p-[var(--reddb-spatial-inset-sm)] text-end font-medium",
                      children: "Value"
                    }
                  )
                ] }) }),
                /* @__PURE__ */ jsx("tbody", { children: rows.map((row) => /* @__PURE__ */ jsxs(
                  "tr",
                  {
                    className: "border-b border-muted",
                    "data-selected": selected === row.id ? "" : void 0,
                    children: [
                      /* @__PURE__ */ jsxs(
                        "th",
                        {
                          scope: "row",
                          className: "p-[var(--reddb-spatial-inset-sm)] text-start font-regular",
                          children: [
                            row.href ? /* @__PURE__ */ jsx(
                              "a",
                              {
                                href: row.href,
                                className: quietControl({
                                  class: controls.action({ class: "underline focus-visible:outline-2 focus-visible:outline-focus" })
                                }),
                                children: row.label
                              }
                            ) : onSelect ? /* @__PURE__ */ jsx(
                              "button",
                              {
                                type: "button",
                                "aria-pressed": selected === row.id,
                                onClick: () => onSelect(row.id),
                                className: quietControl({
                                  class: controls.action({ class: "cursor-pointer text-start underline focus-visible:outline-2 focus-visible:outline-focus" })
                                }),
                                children: row.label
                              }
                            ) : row.label,
                            row.description && /* @__PURE__ */ jsx("span", { className: "block text-ink-muted", children: row.description })
                          ]
                        }
                      ),
                      /* @__PURE__ */ jsx("td", { className: "p-[var(--reddb-spatial-inset-sm)] text-end font-mono tabular-nums", children: row.value })
                    ]
                  },
                  row.id
                )) })
              ] })
            }
          )
        ] }) : /* @__PURE__ */ jsx("p", { className: "m-0 text-xs text-ink-muted", children: "No data available." })
      ]
    }
  );
}
export {
  VisualizationFrame as default
};
