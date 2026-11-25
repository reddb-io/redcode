import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { Button } from "@reddb-io/design-system/base";
import { operationalView } from "../../src/operational.variants.js";
import { SceneViewport } from "./SceneViewport.js";
import Mark from "./VisualizationMark.js";
import { isometricView } from "../../src/isometric.js";
import { seriesColor, tint, mutedInk, ink } from "../../src/visualization.js";
function IsometricScene({
  label,
  items,
  selected = null,
  focused = null,
  layer = null,
  interactive = false,
  size = "md",
  onselectedchange,
  className
}) {
  const visual = operationalView();
  const { scene, focus } = isometricView(items, layer, focused);
  return /* @__PURE__ */ jsxs(
    "figure",
    {
      "data-isometric-scene": true,
      className: visual.sceneFigure({ class: className }),
      children: [
        /* @__PURE__ */ jsx("figcaption", { className: visual.caption(), children: label }),
        /* @__PURE__ */ jsx(
          SceneViewport,
          {
            label,
            contentWidth: scene.width,
            contentHeight: scene.height,
            focus,
            size,
            children: /* @__PURE__ */ jsxs(
              "svg",
              {
                width: scene.width,
                height: scene.height,
                viewBox: scene.viewBox,
                role: "group",
                "aria-label": label,
                children: [
                  /* @__PURE__ */ jsx("title", { children: label }),
                  scene.boxes.map((box) => /* @__PURE__ */ jsxs(
                    Mark,
                    {
                      id: box.id,
                      label: box.label,
                      selected: selected ?? void 0,
                      onSelect: interactive ? onselectedchange : void 0,
                      children: [
                        /* @__PURE__ */ jsx(
                          "polygon",
                          {
                            points: box.left,
                            fill: tint(seriesColor(box.series), 25),
                            stroke: selected === box.id ? ink : mutedInk
                          }
                        ),
                        /* @__PURE__ */ jsx(
                          "polygon",
                          {
                            points: box.right,
                            fill: tint(seriesColor(box.series), 40),
                            stroke: selected === box.id ? ink : mutedInk
                          }
                        ),
                        /* @__PURE__ */ jsx(
                          "polygon",
                          {
                            points: box.top,
                            fill: tint(
                              seriesColor(box.series),
                              selected === box.id ? 35 : 15
                            ),
                            stroke: selected === box.id ? ink : mutedInk
                          }
                        )
                      ]
                    },
                    box.id
                  ))
                ]
              }
            )
          }
        ),
        /* @__PURE__ */ jsx(
          "ul",
          {
            className: visual.entityList(),
            "aria-label": `${label} entities`,
            "data-mark-equivalent": interactive ? "each" : void 0,
            children: scene.boxes.map((box) => /* @__PURE__ */ jsx("li", { children: interactive ? /* @__PURE__ */ jsxs(
              Button,
              {
                variant: "ghost",
                size: "sm",
                "data-equivalent-for": box.id,
                "aria-pressed": selected === box.id,
                onClick: () => onselectedchange?.(box.id),
                children: [
                  box.label,
                  box.layer ? `: ${box.layer}` : ""
                ]
              }
            ) : /* @__PURE__ */ jsxs(Fragment, { children: [
              box.label,
              box.layer ? `: ${box.layer}` : ""
            ] }) }, box.id))
          }
        )
      ]
    }
  );
}
var IsometricScene_default = IsometricScene;
export {
  IsometricScene,
  IsometricScene_default as default
};
