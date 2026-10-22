import { tv } from "tailwind-variants";
import { TONES } from "./tone.js";
const STATUS_INDICATOR_TONES = TONES;
const STATUS_INDICATOR_STATUSES = TONES;
const TONE = {
  neutral: { mark: "border-control-edge bg-ink-muted" },
  info: {
    mark: "border-[var(--reddb-color-feedback-info-border)] bg-[var(--reddb-color-feedback-info-foreground)]"
  },
  success: {
    mark: "border-[var(--reddb-color-feedback-success-border)] bg-[var(--reddb-color-feedback-success-foreground)]"
  },
  warning: {
    mark: "border-[var(--reddb-color-feedback-warning-border)] bg-[var(--reddb-color-feedback-warning-foreground)]"
  },
  danger: {
    mark: "border-[var(--reddb-color-feedback-danger-border)] bg-[var(--reddb-color-feedback-danger-foreground)]"
  }
};
const statusIndicator = tv({
  slots: {
    root: "inline-flex items-center gap-[var(--reddb-spatial-gap-sm)] text-sm text-foreground",
    mark: "size-2 shrink-0 rounded-full border",
    label: ""
  },
  variants: {
    tone: TONE,
    labelled: {
      true: { label: "" },
      false: { label: "sr-only" }
    }
  },
  defaultVariants: { tone: "neutral", labelled: true }
});
export {
  STATUS_INDICATOR_STATUSES,
  STATUS_INDICATOR_TONES,
  statusIndicator
};
