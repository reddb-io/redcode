import { tv } from "tailwind-variants";
import { typeRoleMerge } from "./type-roles.js";
import { field } from "./field.variants.js";
import { input } from "./input.variants.js";
const fileInput = tv({
  slots: {
    root: "grid gap-[var(--reddb-spatial-gap-sm)]",
    field: field().root(),
    control: input(),
    filename: "text-sm text-ink-muted"
  }
}, typeRoleMerge);
export {
  fileInput
};
