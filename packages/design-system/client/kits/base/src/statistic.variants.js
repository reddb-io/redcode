import { tv } from "tailwind-variants";
import { typeRoleMerge } from "./type-roles.js";
const statistic = tv({
  slots: {
    root: "min-w-0",
    detail: "grid gap-[var(--reddb-spatial-gap-sm)]",
    value: "font-mono text-title font-medium tabular-nums text-foreground",
    description: "text-body text-ink-muted"
  }
}, typeRoleMerge);
export {
  statistic
};
