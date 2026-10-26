"use client";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import {
  Fragment as Fragment2,
  useState,
  useId,
  useRef,
  useLayoutEffect
} from "react";
import { useControllableValue } from "@reddb-io/design-system/base";
import { Button } from "@reddb-io/design-system/base";
import PanZoomViewport from "./PanZoomViewport.js";
import Mark from "./VisualizationMark.js";
import {
  geoData,
  geoLand,
  geoLabelIds,
  MAP_WIDTH,
  MAP_HEIGHT
} from "../../src/geo-map.js";
import { geoMap } from "../../src/geo-map.variants.js";
import {
  edge,
  ink,
  mutedInk,
  surface,
  seriesColor
} from "../../src/visualization.js";
function GeoMap(props) {
  const {
    label,
    description,
    points,
    routes = [],
    geography,
    selected: initialSelected = "",
    onSelectedChange,
    interactive = true,
    size = "md",
    attribution,
    dataLabel = "Explore locations and routes",
    className
  } = props;
  const [view, setView] = useState(void 0);
  const [glyphWidth, setGlyphWidth] = useState(0);
  const [lineHeight, setLineHeight] = useState(0);
  const [selected, setSelected] = useControllableValue(
    props.selected,
    initialSelected,
    props.onSelectedChange
  );
  const glyphProbe = useRef(null);
  useLayoutEffect(() => {
    if (!glyphProbe.current) return;
    const node = glyphProbe.current, measure = () => {
      setGlyphWidth(node.clientWidth);
      setLineHeight(node.clientHeight);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const id = useId();
  const styles = geoMap();
  const data = geoData(points, routes);
  const land = geoLand(geography);
  const scale = view?.scale ?? 1;
  const labels = geoLabelIds(
    data.points,
    selected,
    scale,
    glyphWidth || 8,
    lineHeight || 16
  );
  function select(id2) {
    setSelected(id2);
  }
  return /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsxs(
    "figure",
    {
      "data-geo-map": true,
      className: styles.root({ class: className }),
      "aria-labelledby": `${id}-title`,
      children: [
        /* @__PURE__ */ jsxs("figcaption", { children: [
          /* @__PURE__ */ jsx("p", { id: `${id}-title`, className: styles.title(), children: label }),
          description ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx("p", { className: styles.description(), children: description }) }) : null
        ] }),
        /* @__PURE__ */ jsx(
          "span",
          {
            ref: glyphProbe,
            className: "pointer-events-none invisible absolute font-mono text-caption",
            "aria-hidden": "true",
            children: "M"
          }
        ),
        /* @__PURE__ */ jsx(
          PanZoomViewport,
          {
            label: `${label} map`,
            contentWidth: MAP_WIDTH,
            contentHeight: MAP_HEIGHT,
            aspectRatio: MAP_WIDTH / MAP_HEIGHT,
            size,
            view,
            onViewChange: setView,
            children: /* @__PURE__ */ jsxs(
              "svg",
              {
                xmlns: "http://www.w3.org/2000/svg",
                viewBox: `0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`,
                className: styles.svg(),
                role: "group",
                "aria-label": label,
                children: [
                  /* @__PURE__ */ jsx("defs", { children: /* @__PURE__ */ jsx("clipPath", { id: `${id}-clip`, children: /* @__PURE__ */ jsx("rect", { width: MAP_WIDTH, height: MAP_HEIGHT }) }) }),
                  /* @__PURE__ */ jsxs("g", { clipPath: `url(#${id}-clip)`, children: [
                    /* @__PURE__ */ jsx("rect", { width: MAP_WIDTH, height: MAP_HEIGHT, fill: surface }),
                    [-60, -30, 0, 30, 60].map((latitude, index) => {
                      return /* @__PURE__ */ jsx(Fragment2, { children: /* @__PURE__ */ jsx(
                        "path",
                        {
                          d: `M0,${(90 - latitude) / 180 * MAP_HEIGHT} H${MAP_WIDTH}`,
                          stroke: edge,
                          strokeWidth: "1",
                          fill: "none"
                        }
                      ) }, index);
                    }),
                    [-120, -60, 0, 60, 120].map((longitude, index) => {
                      return /* @__PURE__ */ jsx(Fragment2, { children: /* @__PURE__ */ jsx(
                        "path",
                        {
                          d: `M${(longitude + 180) / 360 * MAP_WIDTH},0 V${MAP_HEIGHT}`,
                          stroke: edge,
                          strokeWidth: "1",
                          fill: "none"
                        }
                      ) }, index);
                    }),
                    land.map((path, index) => {
                      return /* @__PURE__ */ jsx(Fragment2, { children: /* @__PURE__ */ jsx(
                        "path",
                        {
                          d: path,
                          fill: "var(--reddb-color-muted)",
                          stroke: edge,
                          strokeWidth: "1",
                          fillRule: "evenodd"
                        }
                      ) }, index);
                    }),
                    data.routes.map((route, index) => {
                      return /* @__PURE__ */ jsx(Fragment2, { children: /* @__PURE__ */ jsxs("g", { role: "group", "aria-label": route.label, children: [
                        /* @__PURE__ */ jsx("title", { children: route.label }),
                        route.paths.map((path, index2) => {
                          return /* @__PURE__ */ jsx(Fragment2, { children: /* @__PURE__ */ jsx(
                            "path",
                            {
                              d: path,
                              fill: "none",
                              stroke: seriesColor(route.series),
                              strokeWidth: 2 / scale
                            }
                          ) }, index2);
                        })
                      ] }) }, route.id);
                    }),
                    data.points.map((point, index) => {
                      return /* @__PURE__ */ jsx(Fragment2, { children: /* @__PURE__ */ jsxs(
                        Mark,
                        {
                          id: point.id,
                          label: point.description ? `${point.label}: ${point.description}` : point.label,
                          selected,
                          onSelect: interactive ? select : void 0,
                          children: [
                            /* @__PURE__ */ jsx(
                              "circle",
                              {
                                cx: point.position[0],
                                cy: point.position[1],
                                r: 22 / scale,
                                fill: "transparent"
                              }
                            ),
                            /* @__PURE__ */ jsx(
                              "circle",
                              {
                                cx: point.position[0],
                                cy: point.position[1],
                                r: (selected === point.id ? 6 : 4) / scale,
                                fill: seriesColor(point.series),
                                stroke: selected === point.id ? ink : surface,
                                strokeWidth: 2 / scale
                              }
                            ),
                            labels.has(point.id) ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
                              "text",
                              {
                                x: point.position[0] + (point.position[0] > 800 ? -12 : 12) / scale,
                                y: point.position[1] - 10 / scale,
                                textAnchor: point.position[0] > 800 ? "end" : "start",
                                fill: selected === point.id ? ink : mutedInk,
                                className: "font-mono",
                                style: {
                                  fontSize: `calc(var(--reddb-type-caption-font-size) / ${scale})`
                                },
                                children: point.label
                              }
                            ) }) : null
                          ]
                        }
                      ) }, point.id);
                    })
                  ] })
                ]
              }
            )
          }
        ),
        attribution ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx("p", { className: styles.description(), children: attribution }) }) : null,
        /* @__PURE__ */ jsxs("details", { className: styles.data(), children: [
          /* @__PURE__ */ jsxs(
            "summary",
            {
              className: "w-fit cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
              children: [
                dataLabel,
                " (",
                points.length,
                ")"
              ]
            }
          ),
          /* @__PURE__ */ jsx("ul", { className: styles.list(), "aria-label": `${label} locations`, children: points.map((point, index) => {
            return /* @__PURE__ */ jsx(Fragment2, { children: /* @__PURE__ */ jsxs("li", { className: styles.row(), children: [
              interactive ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
                Button,
                {
                  variant: "ghost",
                  size: "sm",
                  "aria-pressed": selected === point.id,
                  onClick: () => select(point.id),
                  children: point.label
                }
              ) }) : /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx("span", { children: point.label }) }),
              /* @__PURE__ */ jsxs("span", { children: [
                point.latitude.toFixed(2),
                "\xB0, ",
                point.longitude.toFixed(2),
                "\xB0",
                point.description ? ` \xB7 ${point.description}` : ""
              ] })
            ] }) }, point.id);
          }) }),
          routes.length ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx("ul", { className: styles.list(), "aria-label": `${label} routes`, children: routes.map((route, index) => {
            return /* @__PURE__ */ jsx(Fragment2, { children: /* @__PURE__ */ jsx("li", { children: route.label }) }, route.id);
          }) }) }) : null
        ] })
      ]
    }
  ) });
}
var GeoMap_default = GeoMap;
export {
  GeoMap,
  GeoMap_default as default
};
