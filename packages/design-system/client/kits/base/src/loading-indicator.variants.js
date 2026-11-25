import { tv } from "tailwind-variants";
import { typeRoleMerge } from "./type-roles.js";
const role = (name) => `[--reddb-glyph-size:var(--reddb-type-${name}-glyph-size)] [--reddb-glyph-gap:var(--reddb-type-${name}-glyph-gap)]`;
const SIZE = {
  sm: { root: role("caption"), label: "text-caption" },
  md: { root: role("label"), label: "text-body" },
  lg: { root: role("body"), label: "text-base" }
};
const LONE = {
  sm: "size-[var(--reddb-spatial-icon-size-sm)]",
  md: "size-[var(--reddb-spatial-icon-size-md)]",
  lg: "size-[var(--reddb-spatial-icon-size-lg)]"
};
const loadingIndicator = tv({
  slots: {
    root: "inline-flex items-center justify-center gap-[var(--reddb-glyph-gap)] text-ink-muted",
    spinner: "shrink-0 motion-safe:animate-spin motion-reduce:animate-pulse text-primary-text",
    track: "fill-none stroke-current opacity-25 motion-reduce:opacity-50",
    head: "fill-none stroke-current",
    label: "leading-tight"
  },
  variants: {
    size: SIZE,
    labelHidden: {
      true: { label: "sr-only" },
      false: { label: "", spinner: "size-[var(--reddb-glyph-size)]" }
    }
  },
  compoundVariants: Object.keys(LONE).map((size) => ({
    size,
    labelHidden: true,
    class: { spinner: LONE[size] }
  })),
  defaultVariants: { size: "md", labelHidden: false }
}, typeRoleMerge);
const LOADING_INDICATOR_SIZES = Object.keys(SIZE);
export {
  LOADING_INDICATOR_SIZES,
  loadingIndicator
};
