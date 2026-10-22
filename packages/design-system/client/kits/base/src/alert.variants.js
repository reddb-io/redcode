import { tv } from "tailwind-variants";
import { FEEDBACK_TONES, TONES } from "./tone.js";
const ALERT_TONES = TONES;
const ALERT_FEEDBACK_ROLES = FEEDBACK_TONES;
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
    "text-sm"
  ].join(" "),
  variants: { tone: TONE },
  defaultVariants: { tone: "neutral" }
});
export {
  ALERT_FEEDBACK_ROLES,
  ALERT_TONES,
  alert
};
