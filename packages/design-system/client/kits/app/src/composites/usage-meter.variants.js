import { tv } from "tailwind-variants";
import { typeRoleMerge } from "@reddb-io/design-system/base/recipes";
const usageMeter = tv({
  slots: {
    root: "grid min-w-0 gap-[var(--reddb-spatial-gap-sm)]",
    segments: "m-0 grid list-none gap-[var(--reddb-spatial-gap-sm)] p-0",
    segment: "flex min-w-0 justify-between items-baseline gap-[var(--reddb-spatial-gap-md)] text-caption text-ink-muted",
    amount: "tabular-nums text-foreground"
  }
}, typeRoleMerge);
export {
  usageMeter
};
