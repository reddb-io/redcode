import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { sceneGeometry, stackItems } from "../../src/isometric.js";
import { seriesColor, tint, mutedInk } from "../../src/visualization.js";
import { operationalView } from "../../src/operational.variants.js";
function ObjectStack({
  label,
  count,
  maxVisible = 8,
  series = 1,
  className
}) {
  const visual = operationalView();
  const stack = stackItems(count, maxVisible), scene = sceneGeometry(stack.items);
  return /* @__PURE__ */ jsxs("figure", { "data-object-stack": true, className: visual.figure({ class: className }), children: [
    stack.shown > 0 && /* @__PURE__ */ jsxs(
      "svg",
      {
        viewBox: scene.viewBox,
        role: "img",
        "aria-label": `${label}: ${count}`,
        className: visual.svg(),
        children: [
          /* @__PURE__ */ jsx("title", { children: `${label}: ${count}` }),
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
    ),
    /* @__PURE__ */ jsxs("figcaption", { className: visual.text(), children: [
      label,
      ": ",
      /* @__PURE__ */ jsx("span", { className: visual.count(), children: count }),
      count > stack.shown && /* @__PURE__ */ jsxs(Fragment, { children: [
        " \xB7 ",
        stack.shown,
        " representatives shown"
      ] })
    ] })
  ] });
}
var ObjectStack_default = ObjectStack;
export {
  ObjectStack,
  ObjectStack_default as default
};
