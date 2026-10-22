import { tv } from "tailwind-variants";
import { field } from "./field.variants.js";
const fieldset = tv({
  slots: {
    root: "group/fieldset grid min-w-0 gap-[var(--reddb-spatial-layout-gap-sm)] border-0 p-0",
    legend: [
      "mb-[var(--reddb-spatial-layout-gap-sm)] text-sm font-medium text-foreground",
      "group-disabled/fieldset:text-ink-muted"
    ].join(" "),
    help: field().help(),
    error: field().error()
  }
});
export {
  fieldset
};
