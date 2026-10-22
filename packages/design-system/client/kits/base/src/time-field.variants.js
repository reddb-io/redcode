import { tv } from "tailwind-variants";
import { typeRoleMerge } from "./type-roles.js";
import { field } from "./field.variants.js";
import { input } from "./input.variants.js";
const timeField = tv({
  slots: {
    root: field().root(),
    segments: "flex items-center gap-[var(--reddb-spatial-gap-sm)]",
    segment: [
      input(),
      "w-[var(--reddb-spatial-control-height-md)] px-0 text-center tabular-nums"
    ].join(" "),
    separator: "text-foreground"
  }
}, typeRoleMerge);
export {
  timeField
};
