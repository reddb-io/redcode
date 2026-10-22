import { tv } from "tailwind-variants";
import { FIELD_LAYOUTS } from "./core/field.js";
const LAYOUT = {
  stacked: { root: "", label: "", help: "", error: "" },
  inline: {
    root: "grid-cols-[auto_minmax(0,1fr)] items-center gap-x-[var(--reddb-spatial-gap-md)]",
    label: "cursor-pointer",
    help: "col-start-2",
    error: "col-start-2"
  }
};
const field = tv({
  slots: {
    root: "group/field grid content-start gap-[var(--reddb-spatial-gap-sm)]",
    label: [
      "text-sm font-medium text-foreground",
      "group-has-[:is(input,select,textarea,button):disabled]/field:cursor-not-allowed",
      "group-has-[:is(input,select,textarea,button):disabled]/field:text-ink-muted"
    ].join(" "),
    required: "ms-[var(--reddb-spatial-gap-sm)]",
    help: "text-sm text-ink-muted",
    error: "text-sm font-medium text-feedback-danger-foreground"
  },
  variants: { layout: LAYOUT },
  defaultVariants: { layout: "stacked" }
});
export {
  FIELD_LAYOUTS,
  field
};
