import { gridList, list } from "@reddb-io/design-system/base";
import { tv } from "tailwind-variants";
const ROOT = list({
  gap: "md",
  class: gridList({ columns: 2, class: "min-w-0" })
});
const productList = tv({
  slots: {
    root: ROOT,
    item: "min-w-0",
    card: "h-full min-w-0",
    media: "overflow-hidden rounded-md bg-muted",
    identity: "flex min-w-0 items-baseline justify-between gap-[var(--reddb-spatial-gap-md)]",
    // The product's name reads in the Theme's `heading` role, through the
    // Base Heading (ADR 0025).
    name: "min-w-0",
    price: "shrink-0 text-sm font-medium text-foreground",
    description: "text-sm text-ink-muted",
    actions: "flex flex-wrap items-center gap-[var(--reddb-spatial-gap-sm)]",
    empty: "text-sm text-ink-muted"
  },
  variants: {
    columns: {
      1: { root: gridList({ columns: 1 }) },
      2: { root: gridList({ columns: 2 }) },
      3: { root: gridList({ columns: 3 }) },
      4: { root: gridList({ columns: 4 }) }
    }
  },
  defaultVariants: { columns: 2 }
});
export {
  productList
};
