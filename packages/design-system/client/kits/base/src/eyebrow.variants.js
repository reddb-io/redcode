import { tv } from "tailwind-variants";
import { typeRoleMerge } from "./type-roles.js";
const eyebrow = tv({ base: "text-eyebrow uppercase text-ink-muted" }, typeRoleMerge);
const EYEBROW_ELEMENTS = ["p", "span", "div"];
export {
  EYEBROW_ELEMENTS,
  eyebrow
};
