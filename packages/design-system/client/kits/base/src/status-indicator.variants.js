import { tv } from "tailwind-variants";
import { typeRoleMerge } from "./type-roles.js";
import { TONES } from "./tone.js";
const STATUS_INDICATOR_TONES = TONES;
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
    // The mark stands in for the label, so it pairs with it as a glyph does
    // (ADR 0054): the label role's gap, the same at every Density.
    root: "inline-flex min-w-0 max-w-full items-center gap-[var(--reddb-glyph-gap)] [--reddb-glyph-size:var(--reddb-type-label-glyph-size)] [--reddb-glyph-gap:var(--reddb-type-label-glyph-gap)] text-label font-regular text-foreground",
    mark: "size-2 shrink-0 rounded-full border",
    label: "min-w-0 wrap-break-word"
  },
  variants: {
    tone: TONE,
    labelled: {
      true: { label: "" },
      false: { label: "sr-only" }
    }
  },
  defaultVariants: { tone: "neutral", labelled: true }
}, typeRoleMerge);
export {
  STATUS_INDICATOR_TONES,
  statusIndicator
};
