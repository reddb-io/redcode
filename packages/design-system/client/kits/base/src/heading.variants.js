import { tv } from "tailwind-variants";
import { typeRoleMerge } from "./type-roles.js";
const ROLE = {
  display: "text-display",
  title: "text-title",
  heading: "text-heading"
};
const heading = tv(
  {
    base: "text-foreground text-balance",
    variants: { role: ROLE },
    defaultVariants: { role: "heading" }
  },
  typeRoleMerge
);
const HEADING_ROLES = Object.keys(ROLE);
const HEADING_LEVELS = [1, 2, 3, 4, 5, 6];
function defaultHeadingRole(level) {
  return level === 1 ? "title" : "heading";
}
export {
  HEADING_LEVELS,
  HEADING_ROLES,
  defaultHeadingRole,
  heading
};
