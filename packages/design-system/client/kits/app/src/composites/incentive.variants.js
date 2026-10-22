import { mediaObject } from "@reddb-io/design-system/base";
import { tv } from "tailwind-variants";
const ROOT = mediaObject({ align: "start", gap: "md" }).root({
  class: "isolate w-full min-w-0"
});
const incentive = tv({
  slots: {
    root: ROOT,
    icon: "flex shrink-0 items-center justify-center rounded-full border border-muted p-[var(--reddb-spatial-inset-sm)] text-foreground",
    content: "min-w-0",
    heading: "items-start pb-0"
  }
});
export {
  incentive
};
