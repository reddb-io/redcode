import { tv } from "tailwind-variants";
import { typeRoleMerge } from "./type-roles.js";
import { TONES } from "./tone.js";
const ALERT_TONES = TONES;
const TONE = {
  neutral: "border-transparent bg-muted text-foreground",
  info: "border-feedback-info-border bg-feedback-info-surface text-feedback-info-foreground",
  success: "border-feedback-success-border bg-feedback-success-surface text-feedback-success-foreground",
  warning: "border-feedback-warning-border bg-feedback-warning-surface text-feedback-warning-foreground",
  danger: "border-feedback-danger-border bg-feedback-danger-surface text-feedback-danger-foreground"
};
const alert = tv({
  base: [
    "rounded-md border",
    "px-[var(--reddb-spatial-inset-md)] py-[var(--reddb-spatial-inset-sm)]",
    "text-body",
    // A glyph a caller sets beside the message (`Icon size="text"`) follows
    // the body role (ADR 0054).
    "[--reddb-glyph-size:var(--reddb-type-body-glyph-size)] [--reddb-glyph-gap:var(--reddb-type-body-glyph-gap)]"
  ].join(" "),
  variants: { tone: TONE },
  defaultVariants: { tone: "neutral" }
}, typeRoleMerge);
export {
  ALERT_TONES,
  alert
};
