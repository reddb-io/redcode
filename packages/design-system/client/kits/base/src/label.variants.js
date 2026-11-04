import { tv } from "tailwind-variants";
import { typeRoleMerge } from "./type-roles.js";
const label = tv({
  base: "text-sm font-medium text-foreground"
}, typeRoleMerge);
export {
  label
};
