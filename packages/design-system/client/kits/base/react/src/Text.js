import { createElement } from "react";
import { text, defaultTextInk } from "../../src/text.variants.js";
function Text({ role = "body", ink, as = "p", className, ...rest }) {
  return createElement(as ?? "p", { ...rest, "data-text": true, "data-type-role": role, className: text({ role, ink: ink ?? defaultTextInk(role), class: className }) });
}
export {
  Text
};
