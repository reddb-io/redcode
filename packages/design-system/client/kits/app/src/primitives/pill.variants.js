import { TONES, hitArea, typeRoleMerge } from "@reddb-io/design-system/base/recipes";
import { tv } from "tailwind-variants";
const PILL_VARIANTS = ["tinted", "filled", "outline"];
const PILL_TONES = TONES;
const APPEARANCE = {
  tinted: {
    neutral: "border-transparent bg-muted text-foreground",
    info: "border-transparent bg-feedback-info-surface text-feedback-info-foreground",
    success: "border-transparent bg-feedback-success-surface text-feedback-success-foreground",
    warning: "border-transparent bg-feedback-warning-surface text-feedback-warning-foreground",
    danger: "border-transparent bg-feedback-danger-surface text-feedback-danger-foreground"
  },
  filled: {
    neutral: "border-transparent bg-foreground text-background",
    info: "border-transparent bg-feedback-info-foreground text-on-feedback",
    success: "border-transparent bg-feedback-success-foreground text-on-feedback",
    warning: "border-transparent bg-feedback-warning-foreground text-on-feedback",
    danger: "border-transparent bg-feedback-danger-foreground text-on-feedback"
  },
  outline: {
    neutral: "border-muted bg-transparent text-foreground",
    info: "border-feedback-info-border bg-transparent text-feedback-info-foreground",
    success: "border-feedback-success-border bg-transparent text-feedback-success-foreground",
    warning: "border-feedback-warning-border bg-transparent text-feedback-warning-foreground",
    danger: "border-feedback-danger-border bg-transparent text-feedback-danger-foreground"
  }
};
const TONE = { neutral: "", info: "", success: "", warning: "", danger: "" };
const VARIANT = { tinted: "", filled: "", outline: "" };
const SIZE = {
  sm: "px-2.5 py-0.5 text-caption",
  md: "px-[var(--reddb-spatial-inset-sm)] py-1 text-body"
};
const pill = tv({
  base: "inline-flex items-center gap-1.5 rounded-full border leading-tight whitespace-nowrap",
  variants: { tone: TONE, variant: VARIANT, size: SIZE },
  compoundVariants: [
    ...Object.entries(APPEARANCE).flatMap(
      ([variant, tones]) => Object.entries(tones).map(([tone, className]) => ({
        variant,
        tone,
        class: className
      }))
    )
  ],
  defaultVariants: { tone: "neutral", variant: "tinted", size: "md" }
}, typeRoleMerge);
const pillDismiss = tv({
  base: [
    "relative -me-1 inline-flex items-center justify-center rounded-full border border-transparent bg-transparent p-0.5 leading-tight",
    hitArea({ axis: "both" })
  ].join(" ")
}, typeRoleMerge);
const PILL_SIZES = Object.keys(SIZE);
export {
  PILL_SIZES,
  PILL_TONES,
  PILL_VARIANTS,
  pill,
  pillDismiss
};
