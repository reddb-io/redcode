import { tv } from "tailwind-variants";
import { typeRoleMerge } from "@reddb-io/design-system/base/recipes";
const SIZE = {
  /** The default: a row you can hit with a thumb. */
  md: {
    root: "gap-[var(--reddb-spatial-gap-lg)] px-[var(--reddb-spatial-inset-md)] py-[var(--reddb-spatial-inset-sm)]"
  },
  /** For long lists where the scan matters more than the target. */
  sm: {
    root: "min-h-[var(--reddb-spatial-control-height-md)] gap-[var(--reddb-spatial-gap-md)] px-[var(--reddb-spatial-inset-sm)] py-[var(--reddb-spatial-gap-md)]"
  }
};
const INTERACTIVE = {
  true: {
    // Hover, pressed, focus and disabled are the quiet-control contract the
    // component wraps an interactive row in (wave 6A).
    root: "cursor-pointer"
  },
  false: { root: "" }
};
const SELECTED = {
  /** The row this list is currently about. */
  true: { root: "bg-state-selected", title: "font-medium text-foreground" },
  false: { root: "" }
};
const listRow = tv({
  slots: {
    // `text-start` rather than the browser's default, because this same row is
    // sometimes a <button>, which centres its text.
    root: "flex w-full items-center border-b border-muted text-start",
    leading: "flex shrink-0 items-center",
    text: "flex min-w-0 flex-col gap-0.5",
    title: "truncate text-label text-foreground",
    description: "truncate text-caption text-ink-muted",
    trailing: "ms-auto flex shrink-0 items-center gap-[var(--reddb-spatial-gap-md)]"
  },
  variants: { size: SIZE, interactive: INTERACTIVE, selected: SELECTED },
  defaultVariants: { size: "md", interactive: false, selected: false }
}, typeRoleMerge);
const LIST_ROW_SIZES = Object.keys(SIZE);
export {
  LIST_ROW_SIZES,
  listRow
};
