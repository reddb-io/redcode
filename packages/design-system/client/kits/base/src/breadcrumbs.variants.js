import { tv } from "tailwind-variants";
import { rowOverflow } from "./overflow.variants.js";
import { typeRoleMerge } from "./type-roles.js";
const collapsing = rowOverflow({ policy: "collapse" });
const breadcrumbs = tv({
  slots: {
    root: "text-caption font-regular text-ink-muted",
    list: "m-0 flex list-none items-center gap-[var(--reddb-spatial-gap-lg)] ps-0",
    item: "flex items-center gap-[var(--reddb-spatial-gap-lg)]",
    current: "font-regular text-foreground",
    // The visible link stays one caption line; its hit area is the target
    // floor (24px, 44px under a coarse pointer, ADR 0022), centred on it.
    link: [
      "relative font-regular text-ink-muted hover:text-foreground focus-visible:text-foreground underline-offset-[calc(var(--reddb-spatial-gap-sm)/2)]",
      "before:absolute before:left-1/2 before:top-1/2 before:h-[var(--reddb-spatial-target-min)] before:w-full before:min-w-[var(--reddb-spatial-target-min)] before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']"
    ].join(" "),
    separator: "select-none text-ink-muted/70"
  },
  variants: {
    overflow: {
      wrap: { list: "flex-wrap" },
      // The trail takes the width it is given and measures the middle crumbs
      // against it (ADR 0053). The clipping list keeps a focus ring's room
      // (outline plus offset, gap-sm) inside its contour and gives it back as
      // a negative margin, so rings are drawn whole and the trail stays put.
      collapse: {
        root: "w-full min-w-0",
        list: [collapsing.root(), "w-auto -m-[var(--reddb-spatial-gap-sm)] p-[var(--reddb-spatial-gap-sm)]"].join(" "),
        item: collapsing.item()
      }
    }
  },
  defaultVariants: { overflow: "collapse" }
}, typeRoleMerge);
export {
  breadcrumbs
};
