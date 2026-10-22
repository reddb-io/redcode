import { jsx } from "react/jsx-runtime";
import { SectionHeading } from "@reddb-io/design-system/base";
import { cardHeading } from "../../src/composites/card-heading.variants.js";
function CardHeading({ title, description, level = 2, size = "sm", actions, className, ...rest }) {
  return /* @__PURE__ */ jsx(SectionHeading, { ...rest, "data-card-heading": true, title, description, level, size, actions, rule: false, className: cardHeading({ class: className }) });
}
export {
  CardHeading
};
