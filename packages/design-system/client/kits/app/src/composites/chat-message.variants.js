import { tv } from "tailwind-variants";
import { typeRoleMerge } from "@reddb-io/design-system/base/recipes";
const chatMessage = tv({
  slots: {
    root: "min-w-0 text-foreground",
    content: "grid min-w-0 gap-[var(--reddb-spatial-gap-md)]",
    header: "flex flex-wrap items-baseline gap-[var(--reddb-spatial-gap-sm)]",
    author: "font-medium text-foreground",
    time: "text-body tabular-nums text-ink-muted",
    body: "min-w-0 text-body text-foreground",
    actions: "flex flex-wrap items-center gap-[var(--reddb-spatial-gap-sm)]",
    note: "m-0 text-caption text-ink-muted",
    failure: "m-0 text-caption text-feedback-danger-foreground",
    announcement: "sr-only"
  },
  variants: {
    // An assistant's turn reads on a quiet surface so a long exchange keeps
    // its speakers apart without colour carrying the meaning (ADR 0059).
    speaker: {
      user: {},
      assistant: { root: "rounded-md bg-muted p-[var(--reddb-spatial-inset-sm)]" },
      system: { root: "text-ink-muted", body: "text-ink-muted" }
    }
  },
  defaultVariants: { speaker: "user" }
}, typeRoleMerge);
export {
  chatMessage
};
