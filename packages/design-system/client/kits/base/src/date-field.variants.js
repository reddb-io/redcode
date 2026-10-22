import { tv } from "tailwind-variants";
import { typeRoleMerge } from "./type-roles.js";
import { field } from "./field.variants.js";
import { input } from "./input.variants.js";
const segment = [
  input(),
  "w-[var(--reddb-spatial-control-height-md)] px-0 text-center tabular-nums"
].join(" ");
const dateField = tv({
  slots: {
    root: field().root(),
    segments: "flex items-center gap-[var(--reddb-spatial-gap-sm)]",
    year: [segment, "w-[calc(var(--reddb-spatial-control-height-md)*1.5)]"].join(" "),
    segment,
    separator: "text-foreground"
  }
}, typeRoleMerge);
export {
  dateField
};
