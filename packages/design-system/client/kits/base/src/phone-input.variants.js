import { tv } from "tailwind-variants";
import { typeRoleMerge } from "./type-roles.js";
const phoneInput = tv({
  slots: {
    root: "min-w-0",
    // The country choice is as wide as its label, up to 14ch, where its
    // summary truncates; the number takes the rest.
    row: "grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-[var(--reddb-spatial-gap-sm)]",
    country: "min-w-0 max-w-[14ch] [&>label]:sr-only",
    input: "min-w-0 w-full tabular-nums",
    popup: "min-w-[min(32ch,calc(100vw-var(--reddb-spatial-inset-lg)*2))]",
    read: "grid min-w-0 gap-[var(--reddb-spatial-gap-sm)]",
    label: "text-label text-foreground",
    value: "flex min-w-0 min-h-[var(--reddb-spatial-control-height-md)] items-center gap-[var(--reddb-spatial-gap-sm)] text-editable-md",
    number: "min-w-0 select-text wrap-break-word",
    flag: "shrink-0",
    help: "m-0 text-caption text-ink-muted",
    error: "m-0 text-caption text-feedback-danger-foreground"
  }
}, typeRoleMerge);
export {
  phoneInput
};
