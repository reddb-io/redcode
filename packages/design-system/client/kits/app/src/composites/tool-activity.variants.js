import { tv } from "tailwind-variants";
import { typeRoleMerge } from "@reddb-io/design-system/base/recipes";
const toolActivity = tv({
  slots: {
    root: "min-w-0",
    steps: "m-0 grid list-none gap-[var(--reddb-spatial-gap-sm)] p-0",
    // A grid item's minimum width is its content's: a wide caller-owned detail
    // (a log line, a diff) would widen the whole activity past its container.
    item: "min-w-0",
    detail: "min-w-0 overflow-x-auto",
    step: "flex min-w-0 items-baseline gap-[var(--reddb-spatial-gap-sm)] text-body",
    kind: "shrink-0 text-caption text-ink-muted",
    label: "min-w-0 wrap-break-word font-mono text-foreground",
    status: "ms-auto shrink-0 text-caption"
  },
  variants: {
    state: {
      running: { status: "text-ink-muted" },
      succeeded: { status: "text-feedback-success-foreground" },
      failed: { status: "text-feedback-danger-foreground" },
      cancelled: { status: "text-ink-muted" }
    }
  }
}, typeRoleMerge);
export {
  toolActivity
};
