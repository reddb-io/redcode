import { tv } from "tailwind-variants";
import { slider } from "@reddb-io/design-system/base/recipes";
const visualizationControls = tv({
  slots: {
    root: "mt-[var(--reddb-spatial-gap-md)] flex min-w-0 flex-wrap items-center gap-[var(--reddb-spatial-gap-md)] text-caption",
    field: "flex min-w-0 max-w-full flex-[1_1_24ch] items-center gap-[var(--reddb-spatial-gap-sm)]",
    range: slider().control({ class: "min-w-0 flex-1" }),
    action: "inline-flex min-h-[var(--reddb-spatial-control-height-sm)] min-w-[var(--reddb-spatial-target-min)] max-w-full items-center wrap-break-word",
    summary: "min-h-[var(--reddb-spatial-control-height-sm)] content-center"
  }
});
export {
  visualizationControls
};
