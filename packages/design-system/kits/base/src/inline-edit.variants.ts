import { tv } from "tailwind-variants";
import { typeRoleMerge } from "./type-roles";

export const inlineEdit = tv({
  slots: {
    root: "flex min-w-0 flex-col gap-[var(--reddb-spatial-gap-sm)] text-foreground",
    label: "text-caption text-ink-muted",
    row: "flex min-w-0 flex-wrap items-center gap-[var(--reddb-spatial-gap-sm)]",
    value: "min-w-0 break-words text-body font-medium",
    input: "min-w-0 flex-1 basis-[12ch]",
    error: "m-0 text-caption text-feedback-danger-foreground",
  },
}, typeRoleMerge);
