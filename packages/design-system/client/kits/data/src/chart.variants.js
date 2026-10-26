import { tv } from "tailwind-variants";
const chartFigure = tv({
  base: [
    "relative m-0 p-[var(--reddb-spatial-inset-sm)] text-foreground",
    "[--color-surface-100:var(--reddb-color-background)]",
    "[--color-surface-200:var(--reddb-color-muted)]",
    "[--color-surface-300:var(--reddb-color-muted)]",
    "[--color-surface-content:var(--reddb-color-foreground)]",
    "[&_.lc-axis-tick-label]:text-xs [&_.lc-axis-tick-label]:font-regular [&_.lc-axis-tick-label]:text-ink-muted"
  ].join(" "),
  variants: {
    /** The Series Role (1–6) the chart's marks are drawn in. */
    series: {
      1: "[--color-primary:var(--reddb-color-series-1)]",
      2: "[--color-primary:var(--reddb-color-series-2)]",
      3: "[--color-primary:var(--reddb-color-series-3)]",
      4: "[--color-primary:var(--reddb-color-series-4)]",
      5: "[--color-primary:var(--reddb-color-series-5)]",
      6: "[--color-primary:var(--reddb-color-series-6)]"
    },
    /**
     * A fluid chart takes its container's width and never sets it: its drawing
     * is sized from the figure, so letting the drawing widen the figure would
     * feed the measurement back into itself and push a phone layout sideways.
     */
    fluid: {
      true: "contain-inline-size",
      false: ""
    }
  },
  defaultVariants: { series: 1, fluid: false }
});
export {
  chartFigure
};
