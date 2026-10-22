import { tv } from "tailwind-variants";
import { typeRoleMerge } from "./type-roles.js";
const SLIDE_CANVAS_WIDTH_REM = 60;
const PINNED_RHYTHM = [
  "[--reddb-spatial-layout-gap-sm:var(--reddb-spacing-4)]",
  "[--reddb-spatial-layout-gap-md:var(--reddb-spacing-6)]",
  "[--reddb-spatial-layout-gap-lg:var(--reddb-spacing-8)]",
  "[--reddb-spatial-section-gap:var(--reddb-spacing-16)]",
  "[--reddb-spatial-section-inset:var(--reddb-spacing-12)]"
].join(" ");
const SURFACE = {
  background: { root: "bg-background after:border-muted" },
  raised: { root: "bg-elevation-raised-surface after:border-elevation-raised-border shadow-elevation-raised" }
};
const slideFrame = tv(
  {
    slots: {
      // The size container the stage measures. `w-full` because a size
      // container takes its width from its parent (ADR 0021); the aspect ratio
      // and clip hold the frame even if the zoom is unsupported. The hairline
      // edge is drawn on an overlay, not as a border, so the frame's content
      // box is exactly 16:9 and the canvas fills it without a sliver.
      root: "@container/slide-frame relative block w-full min-w-0 aspect-video overflow-hidden rounded-lg text-foreground break-inside-avoid after:pointer-events-none after:absolute after:inset-0 after:rounded-lg after:border after:content-['']",
      // The canvas, zoomed to the frame. It is itself a container, so anything
      // composed on a slide lays out against the slide (ADR 0021).
      stage: `@container/slide relative box-border flex w-[60rem] aspect-video flex-col [zoom:tan(atan2(100cqi,60rem))] p-[var(--reddb-spatial-section-inset)] text-body ${PINNED_RHYTHM}`,
      // The safe title area: everything a layout places stays inside it.
      safeArea: "relative flex min-h-0 min-w-0 flex-1 flex-col",
      // The slide number sits in the bottom margin, outside the safe area.
      number: "absolute inset-x-0 bottom-0 flex h-[var(--reddb-spatial-section-inset)] items-center justify-end px-[var(--reddb-spatial-section-inset)] text-caption tabular-nums text-ink-muted"
    },
    variants: { surface: SURFACE },
    defaultVariants: { surface: "background" }
  },
  typeRoleMerge
);
const SLIDE_SURFACES = Object.keys(SURFACE);
export {
  SLIDE_CANVAS_WIDTH_REM,
  SLIDE_SURFACES,
  slideFrame
};
