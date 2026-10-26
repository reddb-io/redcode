import { jsx, jsxs } from "react/jsx-runtime";
import { sceneGeometry } from "../../src/isometric.js";
import { seriesColor, tint, mutedInk } from "../../src/visualization.js";
import { operationalView } from "../../src/operational.variants.js";
function IsometricBlock({
  label,
  width = 4,
  depth = 3,
  height = 1,
  series = 1,
  className
}) {
  const scene = sceneGeometry([
    { id: "block", label, x: 0, y: 0, width, depth, height }
  ]), s = operationalView();
  return /* @__PURE__ */ jsxs(
    "svg",
    {
      "data-isometric-block": true,
      viewBox: scene.viewBox,
      role: "img",
      "aria-label": label,
      className: s.svg({ class: className }),
      children: [
        /* @__PURE__ */ jsx("title", { children: label }),
        scene.boxes.map((box) => /* @__PURE__ */ jsxs("g", { children: [
          /* @__PURE__ */ jsx(
            "polygon",
            {
              points: box.left,
              fill: tint(seriesColor(series), 25),
              stroke: mutedInk
            }
          ),
          /* @__PURE__ */ jsx(
            "polygon",
            {
              points: box.right,
              fill: tint(seriesColor(series), 40),
              stroke: mutedInk
            }
          ),
          /* @__PURE__ */ jsx(
            "polygon",
            {
              points: box.top,
              fill: tint(seriesColor(series), 15),
              stroke: mutedInk
            }
          )
        ] }, box.id))
      ]
    }
  );
}
var IsometricBlock_default = IsometricBlock;
export {
  IsometricBlock,
  IsometricBlock_default as default
};
