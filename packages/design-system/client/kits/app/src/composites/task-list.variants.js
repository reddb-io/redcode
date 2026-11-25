import { tv } from "tailwind-variants";
import { typeRoleMerge } from "@reddb-io/design-system/base/recipes";
const taskList = tv({
  slots: {
    root: "@container/task-list w-full min-w-0 wrap-break-word text-foreground",
    list: "m-0 grid min-w-0 list-none divide-y divide-muted p-0",
    item: "grid min-w-0 gap-[var(--reddb-spatial-layout-gap-sm)] py-[var(--reddb-spatial-inset-md)] first:pt-0 last:pb-0",
    header: "flex min-w-0 flex-wrap items-baseline justify-between gap-[var(--reddb-spatial-gap-sm)]",
    title: "m-0 min-w-0 wrap-break-word text-body font-medium",
    description: "m-0 wrap-break-word text-body text-ink-muted",
    context: "flex min-w-0 wrap-break-word [&>span]:min-w-0 [&>span]:max-w-full flex-wrap gap-x-[var(--reddb-spatial-gap-md)] gap-y-[var(--reddb-spatial-gap-sm)] text-caption text-ink-muted",
    reason: "m-0 wrap-break-word text-caption text-foreground",
    progress: "flex min-w-0 items-center gap-[var(--reddb-spatial-gap-md)]",
    reading: "shrink-0 text-caption tabular-nums text-ink-muted",
    actions: "flex min-w-0 flex-wrap items-center gap-[var(--reddb-spatial-gap-sm)]"
  }
}, typeRoleMerge);
export {
  taskList
};
