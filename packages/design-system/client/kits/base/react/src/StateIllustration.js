import { jsx } from "react/jsx-runtime";
import { createElement } from "react";
import { illustrationAttributes, illustrationNodes } from "../../src/core/state-illustration.js";
import { stateIllustration } from "../../src/state-illustration.variants.js";
const camel = (name) => name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
function geometry(nodes, accent, prefix = "") {
  return nodes.map((node, index) => {
    const key = `${prefix}${index}`, attrs = Object.fromEntries(Object.entries(illustrationAttributes(node, accent)).map(([name, value]) => [camel(name), value]));
    return createElement(node.tag, { ...attrs, key }, node.children ? geometry(node.children, accent, `${key}-`) : void 0);
  });
}
function StateIllustration({ art, size = "md", accent, decorative = true, label, className, ...rest }) {
  if (!decorative && !label?.trim()) throw new Error("StateIllustration requires label when decorative is false");
  const nodes = illustrationNodes(art);
  return /* @__PURE__ */ jsx("svg", { ...rest, xmlns: "http://www.w3.org/2000/svg", width: "480", height: "300", viewBox: "0 0 480 300", role: decorative ? void 0 : "img", "aria-label": decorative ? void 0 : label, "aria-hidden": decorative ? true : void 0, focusable: "false", "data-state-illustration": art.name, className: stateIllustration({ size, class: className }), children: geometry(nodes, accent) });
}
export {
  StateIllustration
};
