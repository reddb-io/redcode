import { tv } from "tailwind-variants";
import { typeRoleMerge } from "./type-roles.js";
const BADGE_VARIANTS = ["tinted", "filled", "outline"];
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
const badge = tv({
  base: [
    // A glyph beside the badge's text follows the caption role (ADR 0054):
    // `Icon size="text"` inside takes its size, and the gap is its gap.
    "inline-flex items-center gap-[var(--reddb-glyph-gap)] [--reddb-glyph-size:var(--reddb-type-caption-glyph-size)] [--reddb-glyph-gap:var(--reddb-type-caption-glyph-gap)] rounded-md border px-[var(--reddb-spatial-gap-md)] py-0.5",
    "text-caption font-medium leading-tight whitespace-nowrap"
  ].join(" "),
  variants: { tone: TONE, variant: VARIANT },
  compoundVariants: [
    ...Object.entries(APPEARANCE).flatMap(
      ([variant, tones]) => Object.entries(tones).map(([tone, className]) => ({
        variant,
        tone,
        class: className
      }))
    )
  ],
  defaultVariants: { tone: "neutral", variant: "tinted" }
}, typeRoleMerge);
export {
  BADGE_VARIANTS,
  badge
};
