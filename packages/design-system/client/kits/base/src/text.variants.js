import { tv } from "tailwind-variants";
import { typeRoleMerge } from "./type-roles.js";
const ROLE = {
  body: "text-body",
  caption: "text-caption"
};
const INK = {
  default: "text-foreground",
  muted: "text-ink-muted"
};
const text = tv(
  {
    base: "",
    variants: { role: ROLE, ink: INK },
    defaultVariants: { role: "body", ink: "default" }
  },
  typeRoleMerge
);
const TEXT_ROLES = Object.keys(ROLE);
const TEXT_INKS = Object.keys(INK);
const TEXT_ELEMENTS = ["p", "span", "div", "small"];
function defaultTextInk(role) {
  return role === "caption" ? "muted" : "default";
}
const TEXT_TONES = TEXT_INKS;
const defaultTextTone = defaultTextInk;
export {
  TEXT_ELEMENTS,
  TEXT_INKS,
  TEXT_ROLES,
  TEXT_TONES,
  defaultTextInk,
  defaultTextTone,
  text
};
