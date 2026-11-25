import { tv } from "tailwind-variants";
import { typeRoleMerge } from "./type-roles.js";
const dropdownMenu = tv({
  slots: {
    content: "min-w-48 overflow-hidden p-[var(--reddb-spatial-inset-sm)]",
    group: "flex flex-col",
    heading: "px-[var(--reddb-spatial-inset-sm)] py-1 text-caption font-medium text-ink-muted",
    separator: "my-1 h-px bg-muted",
    item: [
      "flex w-full select-none items-center rounded-md text-start text-foreground outline-hidden",
      "data-[highlighted]:bg-state-selected data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
    ].join(" "),
    // A row's glyph follows its label (ADR 0054): the row's type role sets the
    // glyph size and gap, the same at every menu size and Density.
    icon: "me-[var(--reddb-glyph-gap)] inline-flex size-[var(--reddb-glyph-size)] shrink-0",
    label: "min-w-0 truncate",
    shortcut: "ms-auto shrink-0 ps-[var(--reddb-spatial-inset-md)]"
  },
  variants: {
    size: {
      sm: {
        item: "h-[var(--reddb-spatial-control-height-sm)] px-[var(--reddb-spatial-inset-sm)] text-label font-regular [--reddb-glyph-size:var(--reddb-type-label-glyph-size)] [--reddb-glyph-gap:var(--reddb-type-label-glyph-gap)]"
      },
      md: {
        item: "h-[var(--reddb-spatial-control-height-md)] px-[var(--reddb-spatial-inset-md)] text-label font-regular [--reddb-glyph-size:var(--reddb-type-label-glyph-size)] [--reddb-glyph-gap:var(--reddb-type-label-glyph-gap)]"
      },
      lg: {
        item: "h-[var(--reddb-spatial-control-height-lg)] px-[var(--reddb-spatial-inset-lg)] text-base [--reddb-glyph-size:var(--reddb-type-body-glyph-size)] [--reddb-glyph-gap:var(--reddb-type-body-glyph-gap)]"
      }
    }
  },
  defaultVariants: { size: "md" }
}, typeRoleMerge);
const DROPDOWN_MENU_SIZES = ["sm", "md", "lg"];
export {
  DROPDOWN_MENU_SIZES,
  dropdownMenu
};
