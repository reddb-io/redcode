import { tv } from "tailwind-variants";
const SIZE = {
  sm: {
    root: "gap-[var(--reddb-spatial-gap-md)] px-[var(--reddb-spatial-inset-md)] py-[var(--reddb-spatial-inset-lg)]",
    title: "text-sm",
    description: "text-xs",
    hint: "text-xs"
  },
  md: {
    root: "gap-[var(--reddb-spatial-gap-lg)] px-[var(--reddb-spatial-inset-lg)] py-10",
    title: "text-base",
    description: "text-sm",
    hint: "text-xs"
  }
};
const BORDERED = {
  true: { root: "border-dashed border-muted" },
  false: { root: "border-transparent" }
};
const emptyState = tv({
  slots: {
    root: "flex flex-col items-center justify-center rounded-lg border text-center",
    media: "text-ink-muted",
    title: "font-medium leading-tight text-foreground",
    description: "max-w-prose text-ink-muted",
    hint: "max-w-full rounded-md border border-muted px-2 py-1 font-mono text-ink-muted",
    actions: "flex flex-wrap items-center justify-center gap-[var(--reddb-spatial-gap-md)] pt-1"
  },
  variants: { size: SIZE, bordered: BORDERED },
  defaultVariants: { size: "md", bordered: true }
});
const EMPTY_STATE_SIZES = Object.keys(SIZE);
export {
  EMPTY_STATE_SIZES,
  emptyState
};
