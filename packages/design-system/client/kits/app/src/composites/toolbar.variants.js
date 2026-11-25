import { tv } from "tailwind-variants";
import { rowOverflow, typeRoleMerge } from "@reddb-io/design-system/base/recipes";
const collapsing = rowOverflow({ policy: "collapse" });
const toolbar = tv({
  slots: {
    root: [
      "inline-flex items-center gap-[var(--reddb-spatial-gap-sm)]",
      "data-[command-toolbar]:items-center",
      "rounded-md border border-muted bg-background p-[var(--reddb-spatial-inset-sm)]"
    ].join(" "),
    item: "inline-flex shrink-0 items-center",
    more: "inline-flex shrink-0 items-center"
  },
  variants: {
    orientation: {
      horizontal: "",
      vertical: { root: "flex-col items-stretch" }
    },
    size: {
      sm: { item: "h-[var(--reddb-spatial-control-height-sm)] px-[var(--reddb-spatial-inset-sm)] text-body" },
      md: { item: "h-[var(--reddb-spatial-control-height-md)] px-[var(--reddb-spatial-inset-md)] text-body" },
      lg: { item: "h-[var(--reddb-spatial-control-height-lg)] px-[var(--reddb-spatial-inset-lg)] text-base" }
    },
    overflow: { wrap: "", collapse: "" }
  },
  compoundVariants: [
    // A horizontal toolbar wraps its items onto another line by default, or
    // collapses the ones that do not fit into More (ADR 0053). A vertical one
    // stacks and never collapses.
    { orientation: "horizontal", overflow: "wrap", class: { root: "flex-wrap" } },
    { orientation: "horizontal", overflow: "collapse", class: { root: collapsing.root(), item: collapsing.item() } }
  ],
  defaultVariants: { orientation: "horizontal", size: "md", overflow: "wrap" }
}, typeRoleMerge);
export {
  toolbar
};
