import { tv } from "tailwind-variants";
import { TONES } from "./tone.js";
const MEASURE_TONE_FILL = {
  neutral: "bg-foreground",
  info: "bg-feedback-info-foreground",
  success: "bg-feedback-success-foreground",
  warning: "bg-feedback-warning-foreground",
  danger: "bg-feedback-danger-foreground"
};
const meter = tv({
  slots: {
    root: "flex w-full flex-col gap-[var(--reddb-spatial-gap-sm)] text-foreground",
    summary: "flex items-baseline justify-between gap-[var(--reddb-spatial-gap-md)]",
    label: "text-sm font-medium",
    value: "text-sm tabular-nums text-ink-muted",
    track: "h-2 w-full overflow-hidden rounded-full bg-muted",
    indicator: "h-full rounded-full transition-[width] motion-reduce:transition-none"
  },
  variants: {
    layout: {
      stacked: {},
      inline: {
        root: "flex-row items-center gap-[var(--reddb-spatial-gap-md)]",
        summary: "order-last shrink-0",
        value: "min-w-[5ch] text-end",
        track: "min-w-0 flex-1"
      }
    },
    labelHidden: { true: { label: "sr-only" } },
    tone: {
      neutral: { indicator: MEASURE_TONE_FILL.neutral },
      info: { indicator: MEASURE_TONE_FILL.info },
      success: { indicator: MEASURE_TONE_FILL.success },
      warning: { indicator: MEASURE_TONE_FILL.warning },
      danger: { indicator: MEASURE_TONE_FILL.danger },
      /** @deprecated The accent is an emphasis, not a tone (ADR 0026); kept one release. */
      primary: { indicator: "bg-primary" }
    }
  },
  defaultVariants: { tone: "neutral", layout: "stacked", labelHidden: false }
});
const METER_TONES = TONES;
export {
  MEASURE_TONE_FILL,
  METER_TONES,
  meter
};
