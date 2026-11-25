import { tv } from "tailwind-variants";
import { typeRoleMerge } from "@reddb-io/design-system/base/recipes";
const CURRENT = {
  /** Where you are. */
  true: { root: "border-foreground bg-state-selected font-medium text-foreground" },
  /** Everywhere else you could go. */
  // Rest, hover, pressed and focus come from the quiet-control contract the
  // component wraps this slot in (wave 6A).
  false: { root: "border-transparent bg-transparent text-ink-muted" }
};
const DISABLED = {
  /** Present, visibly unavailable, and unreachable by pointer or by tab. */
  true: { root: "pointer-events-none opacity-50" },
  false: { root: "" }
};
const navItem = tv({
  slots: {
    // Focus is the ink focus outline every DS control draws (ADR 0023).
    root: "inline-flex w-full items-center gap-[var(--reddb-glyph-gap)] [--reddb-glyph-size:var(--reddb-type-label-glyph-size)] [--reddb-glyph-gap:var(--reddb-type-label-glyph-gap)] rounded-s-none rounded-e-md border-s-2 min-h-[var(--reddb-spatial-control-height-md)] px-[var(--reddb-spatial-inset-sm)] text-body leading-tight focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
    icon: "order-first shrink-0",
    label: "truncate",
    trailing: "ms-auto shrink-0"
  },
  variants: {
    current: CURRENT,
    disabled: DISABLED
  },
  defaultVariants: { current: false, disabled: false }
}, typeRoleMerge);
export {
  navItem
};
