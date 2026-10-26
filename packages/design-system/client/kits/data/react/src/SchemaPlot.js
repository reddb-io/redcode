"use client";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { Fragment as Fragment2 } from "react";
import { useControllableValue } from "@reddb-io/design-system/base";
import Frame from "./VisualizationFrame.js";
import Mark from "./VisualizationMark.js";
import { schemaLayout } from "../../src/schema-diagram.js";
import {
  ink,
  mutedInk,
  edge,
  surface,
  seriesColor,
  tint,
  short
} from "../../src/visualization.js";
function SchemaPlot(props) {
  const {
    data,
    kind,
    label,
    description,
    width,
    height,
    size,
    selected: initialSelected = "",
    onSelectedChange,
    interactive = true,
    detailHref,
    className = "",
    fieldLimit = 8
  } = props;
  const [selected, setSelected] = useControllableValue(
    props.selected,
    initialSelected,
    props.onSelectedChange
  );
  const rows = [
    ...data.entities.map((e) => ({
      ...e,
      value: e.fields.map(
        (f) => `${f.label}: ${f.type}${f.primaryKey ? " PK" : ""}${f.foreignKey ? " FK" : ""}${f.unique ? " UQ" : ""}${f.nullable === false ? " NN" : ""}`
      ).join(" \xB7 ")
    })),
    ...data.relations.map((r) => ({
      ...r,
      value: `${r.source}${r.sourceField ? "." + r.sourceField : ""} \u2192 ${r.target}${r.targetField ? "." + r.targetField : ""}`,
      description: [r.sourceCardinality, r.targetCardinality, r.onDelete].filter(Boolean).join(" \xB7 ")
    }))
  ];
  function select(id) {
    setSelected(id);
  }
  function layout(w, unit = 32) {
    if (!Number.isInteger(fieldLimit) || fieldLimit < 1)
      throw new Error("fieldLimit must be a positive integer");
    return schemaLayout(data, w, fieldLimit, unit);
  }
  return /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
    Frame,
    {
      kind,
      label,
      description,
      width,
      height,
      size,
      selected,
      detailHref,
      rows,
      onSelect: interactive ? select : void 0,
      className,
      children: ({ width: w, height: h, unit }) => {
        const scene = layout(w, unit);
        return /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsxs(
          "svg",
          {
            xmlns: "http://www.w3.org/2000/svg",
            width: w,
            height: Math.max(h, scene.height),
            viewBox: `0 0 ${w} ${Math.max(h, scene.height)}`,
            role: "group",
            "aria-label": label,
            children: [
              /* @__PURE__ */ jsx("title", { children: label }),
              [
                ...new Set(
                  scene.nodes.flatMap((n) => n.group ? [n.group] : [])
                )
              ].map((group, index) => {
                const members = scene.nodes.filter((n) => n.group === group);
                const x = Math.min(...members.map((n) => n.x)) - 10;
                const y = Math.min(...members.map((n) => n.y)) - 12;
                const right = Math.max(...members.map((n) => n.x + n.width)) + 10;
                const bottom = Math.max(...members.map((n) => n.y + n.height)) + 12;
                return /* @__PURE__ */ jsxs(Fragment2, { children: [
                  /* @__PURE__ */ jsx(
                    "rect",
                    {
                      x,
                      y,
                      width: right - x,
                      height: bottom - y,
                      rx: 8,
                      fill: "none",
                      stroke: edge,
                      strokeDasharray: "5 5"
                    }
                  ),
                  /* @__PURE__ */ jsx(
                    "text",
                    {
                      x: x + 10,
                      y: y - 5,
                      fill: mutedInk,
                      className: "font-mono text-xs",
                      children: group
                    }
                  )
                ] }, index);
              }),
              data.relations.map((relation, index) => {
                const source = scene.nodes.find(
                  (n) => n.id === relation.source
                );
                const target = scene.nodes.find(
                  (n) => n.id === relation.target
                );
                const si = source.visible.findIndex(
                  (f) => f.id === relation.sourceField
                );
                const ti = target.visible.findIndex(
                  (f) => f.id === relation.targetField
                );
                const sameColumn = Math.abs(source.x - target.x) < 1;
                const below = target.y > source.y + source.height;
                const forward = target.x >= source.x + source.width;
                const sx = below ? source.x + source.width / 2 : forward ? source.x + source.width : source.x;
                const tx = below ? target.x + target.width / 2 : forward ? target.x : target.x + target.width;
                const sy = below ? source.y + source.height : source.y + (si >= 0 ? source.header + source.inset + source.rowHeight * 0.4 + si * source.rowHeight : 26);
                const ty = below ? target.y : target.y + (ti >= 0 ? target.header + target.inset + target.rowHeight * 0.4 + ti * target.rowHeight : 26);
                const mid = below ? (sy + ty) / 2 : (sx + tx) / 2;
                const color = selected === relation.id ? seriesColor(relation.series, relation.color) : mutedInk;
                const corridor = source.x + source.width + 18;
                const fromY = source.y + (si >= 0 ? source.header + source.inset + source.rowHeight * 0.4 + si * source.rowHeight : source.header * 0.6);
                const toY = target.y + (ti >= 0 ? target.header + target.inset + target.rowHeight * 0.4 + ti * target.rowHeight : target.header * 0.6);
                return /* @__PURE__ */ jsx(Fragment2, { children: /* @__PURE__ */ jsxs(
                  Mark,
                  {
                    id: relation.id,
                    label: `${relation.label}: ${relation.source} \u2192 ${relation.target}${relation.onDelete ? `, ON DELETE ${relation.onDelete}` : ""}`,
                    selected,
                    onSelect: interactive ? select : void 0,
                    children: [
                      /* @__PURE__ */ jsx(
                        "path",
                        {
                          d: sameColumn ? `M${source.x + source.width},${fromY} H${corridor} V${toY} H${target.x + target.width}` : below ? `M${sx},${sy} V${mid} H${tx} V${ty}` : `M${sx},${sy} H${mid} V${ty} H${tx}`,
                          fill: "none",
                          stroke: color,
                          strokeWidth: selected === relation.id ? 2.5 : 1.5
                        }
                      ),
                      /* @__PURE__ */ jsx("circle", { cx: tx, cy: ty, r: 3, fill: color }),
                      /* @__PURE__ */ jsx(
                        "text",
                        {
                          x: below ? sx + 6 : sx + (forward ? 5 : -5),
                          y: sy - 7,
                          textAnchor: below || forward ? "start" : "end",
                          fill: color,
                          className: "font-mono text-xs",
                          children: relation.sourceCardinality ?? ""
                        }
                      ),
                      /* @__PURE__ */ jsx(
                        "text",
                        {
                          x: below ? tx + 6 : tx + (forward ? -5 : 5),
                          y: ty - 7,
                          textAnchor: below || !forward ? "start" : "end",
                          fill: color,
                          className: "font-mono text-xs",
                          children: relation.targetCardinality ?? ""
                        }
                      ),
                      sameColumn ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
                        "text",
                        {
                          x: source.x + source.width / 2,
                          y: below ? (source.y + source.height + target.y) / 2 : (target.y + target.height + source.y) / 2,
                          textAnchor: "middle",
                          fill: color,
                          className: "font-mono text-xs",
                          children: short(
                            relation.label || relation.onDelete || "",
                            32
                          )
                        }
                      ) }) : /* @__PURE__ */ jsx(Fragment, { children: below ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
                        "text",
                        {
                          x: (sx + tx) / 2,
                          y: mid - 7,
                          textAnchor: "middle",
                          fill: color,
                          className: "font-mono text-xs",
                          children: short(
                            relation.label || relation.onDelete || "",
                            28
                          )
                        }
                      ) }) : null })
                    ]
                  }
                ) }, relation.id);
              }),
              scene.nodes.map((node, index) => {
                const color = seriesColor(node.series, node.color);
                const active = selected === node.id || node.kind === "aggregate";
                return /* @__PURE__ */ jsx(Fragment2, { children: /* @__PURE__ */ jsxs(
                  Mark,
                  {
                    id: node.id,
                    label: `${node.label}: ${node.fields.length} fields`,
                    selected,
                    onSelect: interactive ? select : void 0,
                    children: [
                      /* @__PURE__ */ jsx(
                        "rect",
                        {
                          x: node.x,
                          y: node.y,
                          width: node.width,
                          height: node.height,
                          rx: 6,
                          fill: surface,
                          stroke: active ? color : edge,
                          strokeWidth: active ? 2 : 1,
                          strokeDasharray: node.kind === "join" ? "5 4" : void 0
                        }
                      ),
                      /* @__PURE__ */ jsx(
                        "rect",
                        {
                          x: node.x + 1,
                          y: node.y + 1,
                          width: node.width - 2,
                          height: node.header,
                          rx: 5,
                          fill: active ? tint(color, 12) : tint(mutedInk, 5)
                        }
                      ),
                      /* @__PURE__ */ jsx(
                        "text",
                        {
                          x: node.x + 12,
                          y: node.y + node.header * 0.62,
                          fill: ink,
                          className: "text-sm font-medium",
                          children: short(node.label, Math.floor((node.width - 70) / 8))
                        }
                      ),
                      /* @__PURE__ */ jsx(
                        "text",
                        {
                          x: node.x + node.width - 10,
                          y: node.y + node.header * 0.62,
                          textAnchor: "end",
                          fill: mutedInk,
                          className: "font-mono text-xs",
                          children: node.kind ?? (kind === "EntityRelationship" ? "entity" : "table")
                        }
                      ),
                      node.visible.map((field, i) => {
                        const y = node.y + node.header + node.inset + node.rowHeight * 0.4 + i * node.rowHeight;
                        return /* @__PURE__ */ jsxs(Fragment2, { children: [
                          /* @__PURE__ */ jsxs(
                            "text",
                            {
                              x: node.x + 12,
                              y,
                              fill: ink,
                              className: "font-mono text-xs",
                              children: [
                                field.primaryKey ? "# " : field.foreignKey ? "\u2192 " : "",
                                short(field.label, 18)
                              ]
                            }
                          ),
                          /* @__PURE__ */ jsxs(
                            "text",
                            {
                              x: node.x + node.width - 10,
                              y,
                              textAnchor: "end",
                              fill: mutedInk,
                              className: "font-mono text-xs",
                              children: [
                                short(field.type, 17),
                                field.unique ? " UQ" : "",
                                field.nullable === false ? " NN" : ""
                              ]
                            }
                          )
                        ] }, i);
                      }),
                      node.fields.length > fieldLimit ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsxs(
                        "text",
                        {
                          x: node.x + 12,
                          y: node.y + node.header + node.inset + node.rowHeight * 0.4 + fieldLimit * node.rowHeight,
                          fill: mutedInk,
                          className: "text-xs",
                          children: [
                            "+ ",
                            node.fields.length - fieldLimit,
                            " more fields \xB7 Explore data"
                          ]
                        }
                      ) }) : null,
                      node.indexes?.length ? (() => {
                        const y = node.y + node.header + node.inset + (node.visible.length + (node.fields.length > fieldLimit ? 1 : 0)) * node.rowHeight;
                        return /* @__PURE__ */ jsxs(Fragment, { children: [
                          /* @__PURE__ */ jsx(
                            "line",
                            {
                              x1: node.x,
                              x2: node.x + node.width,
                              y1: y,
                              y2: y,
                              stroke: edge
                            }
                          ),
                          /* @__PURE__ */ jsx(
                            "text",
                            {
                              x: node.x + 12,
                              y: y + 20,
                              fill: mutedInk,
                              className: "font-mono text-xs",
                              children: "INDEXES"
                            }
                          ),
                          node.indexes.map((index2, i) => {
                            return /* @__PURE__ */ jsx(Fragment2, { children: /* @__PURE__ */ jsx(
                              "text",
                              {
                                x: node.x + 12,
                                y: y + 40 + i * 20,
                                fill: mutedInk,
                                className: "font-mono text-xs",
                                children: short(
                                  index2,
                                  Math.floor(node.width / 7) - 4
                                )
                              }
                            ) }, i);
                          })
                        ] });
                      })() : null
                    ]
                  }
                ) }, node.id);
              })
            ]
          }
        ) });
      }
    }
  ) });
}
var SchemaPlot_default = SchemaPlot;
export {
  SchemaPlot,
  SchemaPlot_default as default
};
