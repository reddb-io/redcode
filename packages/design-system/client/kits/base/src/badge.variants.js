import { tv } from "tailwind-variants";
const BADGE_VARIANTS = ["tinted", "filled", "outline"];
const DEPRECATED_BADGE_VARIANTS = {
  neutral: "tinted",
  primary: "filled"
};
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
const DEPRECATED_PRIMARY = "border-transparent bg-primary text-on-primary";
const TONE = { neutral: "", info: "", success: "", warning: "", danger: "" };
const VARIANT = { tinted: "", filled: "", outline: "", neutral: "", primary: "" };
const badge = tv({
  base: [
    "inline-flex items-center gap-[var(--reddb-spatial-gap-sm)] rounded-md border px-2 py-0.5",
    "text-xs font-medium leading-tight whitespace-nowrap"
  ].join(" "),
  variants: { tone: TONE, variant: VARIANT },
  compoundVariants: [
    ...Object.entries(APPEARANCE).flatMap(
      ([variant, tones]) => Object.entries(tones).map(([tone, className]) => ({
        variant,
        tone,
        class: className
      }))
    ),
    // The deprecated neutral variant is the tinted badge, tone for tone.
    ...Object.entries(APPEARANCE.tinted).map(([tone, className]) => ({
      variant: "neutral",
      tone,
      class: className
    })),
    { variant: "primary", class: DEPRECATED_PRIMARY }
  ],
  defaultVariants: { tone: "neutral", variant: "tinted" }
});
export {
  BADGE_VARIANTS,
  DEPRECATED_BADGE_VARIANTS,
  badge
};
