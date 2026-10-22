import { jsx } from "react/jsx-runtime";
import { controlGroup } from "../../src/control-group.variants.js";
function ControlGroup({ label, orientation = "horizontal", className, ...rest }) {
  return /* @__PURE__ */ jsx("div", { ...rest, role: "group", "aria-label": label, "data-orientation": orientation, className: controlGroup({ orientation, class: className }) });
}
export {
  ControlGroup
};
