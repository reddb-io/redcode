import { tv } from "tailwind-variants";
const popover = tv({
  base: [
    "z-[var(--reddb-layer-dropdown)] w-80 max-w-[min(var(--container-sm),var(--bits-floating-available-width,var(--available-width,100vw)))] rounded-lg border border-elevation-overlay-border bg-elevation-overlay-surface text-elevation-overlay-foreground shadow-elevation-overlay",
    "p-[var(--reddb-spatial-inset-md)] outline-hidden",
    "motion-safe:transition-opacity motion-reduce:transition-none"
  ].join(" ")
});
const floatingLayer = tv({
  base: "",
  variants: {
    layer: {
      dropdown: "z-[var(--reddb-layer-dropdown)]",
      tooltip: "z-[var(--reddb-layer-tooltip)]"
    }
  },
  defaultVariants: { layer: "dropdown" }
});
export {
  floatingLayer,
  popover
};
