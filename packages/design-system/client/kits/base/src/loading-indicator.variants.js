import { tv } from "tailwind-variants";
const SIZE = {
  sm: { spinner: "size-[var(--reddb-spatial-icon-size-sm)]", label: "text-xs" },
  md: { spinner: "size-[var(--reddb-spatial-icon-size-md)]", label: "text-sm" },
  lg: { spinner: "size-[var(--reddb-spatial-icon-size-lg)]", label: "text-base" }
};
const loadingIndicator = tv({
  slots: {
    root: "inline-flex items-center justify-center gap-[var(--reddb-spatial-gap-md)] text-ink-muted",
    spinner: "motion-safe:animate-spin motion-reduce:animate-pulse text-primary-text",
    track: "fill-none stroke-current opacity-25 motion-reduce:opacity-50",
    head: "fill-none stroke-current",
    label: "leading-tight"
  },
  variants: {
    size: SIZE,
    labelHidden: {
      true: { label: "sr-only" },
      false: { label: "" }
    }
  },
  defaultVariants: { size: "md", labelHidden: false }
});
const LOADING_INDICATOR_SIZES = Object.keys(SIZE);
export {
  LOADING_INDICATOR_SIZES,
  loadingIndicator
};
