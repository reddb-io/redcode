import { tv } from "tailwind-variants";
import { typeRoleMerge } from "./type-roles.js";
const link = tv({
  base: [
    "text-foreground underline decoration-current underline-offset-[var(--reddb-spatial-gap-sm)]",
    "hover:decoration-2",
    "focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
  ].join(" ")
}, typeRoleMerge);
export {
  link
};
