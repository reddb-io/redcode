import { tv } from "tailwind-variants";
import { typeRoleMerge } from "./type-roles.js";
const input = tv({
  base: [
    "flex w-full",
    "rounded-md border border-control-edge bg-background",
    "text-foreground",
    "placeholder:text-ink-muted",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
    "aria-invalid:border-feedback-danger-border",
    "disabled:cursor-not-allowed disabled:opacity-50"
  ].join(" "),
  variants: {
    // The same three steps as Button, so a field and the action beside it
    // share one control height at every Density stop. Named `controlSize` on
    // the component: the native `size` attribute is still spread through.
    size: {
      sm: "h-[var(--reddb-spatial-control-height-sm)] px-[var(--reddb-spatial-inset-sm)] text-editable-sm",
      md: "h-[var(--reddb-spatial-control-height-md)] px-[var(--reddb-spatial-inset-md)] text-editable-md",
      lg: "h-[var(--reddb-spatial-control-height-lg)] px-[var(--reddb-spatial-inset-lg)] text-editable-lg"
    }
  },
  defaultVariants: { size: "md" }
}, typeRoleMerge);
const INPUT_SIZES = ["sm", "md", "lg"];
export {
  INPUT_SIZES,
  input
};
