import { jsx } from "react/jsx-runtime";
import { heading, defaultHeadingRole } from "../../src/heading.variants.js";
function Heading({ level = 2, role, className, ...rest }) {
  const resolvedRole = role ?? defaultHeadingRole(level);
  const Tag = `h${level}`;
  return /* @__PURE__ */ jsx(Tag, { ...rest, "data-heading": true, "data-type-role": resolvedRole, className: heading({ role: resolvedRole, class: className }) });
}
export {
  Heading
};
