import { tv } from "tailwind-variants";
import { typeRoleMerge } from "@reddb-io/design-system/base/recipes";
const approvalPrompt = tv({
  slots: {
    root: "grid min-w-0 gap-[var(--reddb-spatial-gap-md)] rounded-lg border border-feedback-warning-border bg-feedback-warning-surface p-[var(--reddb-spatial-inset-md)] text-foreground",
    title: "m-0 text-label",
    description: "m-0 text-body text-ink-muted",
    request: "min-w-0",
    decisions: "flex flex-wrap items-center gap-[var(--reddb-spatial-gap-sm)]",
    announcement: "sr-only"
  }
}, typeRoleMerge);
export {
  approvalPrompt
};
