import { tv } from "tailwind-variants";
import { typeRoleMerge } from "./type-roles.js";
const countdown = tv({
  slots: {
    root: "inline-flex items-baseline gap-[var(--reddb-spatial-gap-sm)] text-foreground",
    label: "text-body text-ink-muted",
    value: "font-mono text-title font-medium tabular-nums"
  }
}, typeRoleMerge);
export {
  countdown
};
