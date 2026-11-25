import { tv } from "tailwind-variants";
import { typeRoleMerge } from "@reddb-io/design-system/base/recipes";
const review = tv({
  slots: {
    root: "w-full min-w-0 text-foreground",
    card: "w-full",
    identity: "grid min-w-0 gap-[var(--reddb-spatial-gap-sm)]",
    author: "font-medium text-foreground",
    time: "text-body tabular-nums text-ink-muted",
    content: "grid w-full min-w-0 gap-[var(--reddb-spatial-gap-md)]",
    body: "min-w-0 text-body text-foreground",
    actions: "flex flex-wrap items-center gap-[var(--reddb-spatial-gap-sm)]"
  }
}, typeRoleMerge);
export {
  review
};
