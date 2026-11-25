import { tv } from "tailwind-variants";
const toggleGroup = tv({
  slots: {
    root: "min-w-0",
    // The standard segmented control (maintainer decision, 2026-10-06): the
    // group is exactly one Button tall — the control height of its `size`,
    // its border included — and its segments sit flush, split by control-edge
    // dividers. This deliberately drops the inset the group carried since
    // issue 423.
    list: [
      "box-border inline-flex max-w-full flex-nowrap items-stretch gap-0 rounded-md",
      "border border-control-edge"
    ].join(" "),
    // Every option carries the 2px bottom edge the pressed indicator paints,
    // transparent until pressed, so choosing an option moves nothing. Each
    // option but the last draws the divider on its inline end; the outer
    // segments follow the group's rounding so a pressed fill stays inside it.
    option: [
      "h-auto rounded-none border-0 border-b-2 border-e border-transparent border-e-control-edge last:border-e-0",
      "first:rounded-s-md last:rounded-e-md",
      // The list sets the height; a segment stretches to it instead of
      // adding a Button's own minimum inside the list's border.
      "min-h-0 shrink-0 whitespace-nowrap",
      // Drawn inside the segment: the scrolling list would clip an outer ring.
      "focus-visible:-outline-offset-2",
      // The list's 1px border sits outside the stretched segment; the hit area
      // reaches over it so a segment keeps the full touch target (ADR 0054).
      "relative before:absolute before:inset-x-0 before:top-1/2 before:h-[max(100%,var(--reddb-spatial-target-min))] before:-translate-y-1/2 before:content-['']"
    ].join(" ")
  },
  variants: {
    // Peers share a size (ADR 0054): the group takes the same sm | md | lg
    // steps as Button and the fields (ADR 0026), so a ToggleGroup sits level
    // with an Input or Select of the same size. The contour is one step's
    // control height at 100% text (`min-h`, so enlarged text grows it); the
    // segments stretch to it with the step's inset and Button's text size.
    // The line height comes last: a text size would otherwise merge it away.
    size: {
      sm: {
        list: "min-h-[var(--reddb-spatial-control-height-sm)]",
        option: "px-[var(--reddb-spatial-inset-sm)] text-label leading-tight"
      },
      md: {
        list: "min-h-[var(--reddb-spatial-control-height-md)]",
        option: "px-[var(--reddb-spatial-inset-md)] text-label leading-tight"
      },
      lg: {
        list: "min-h-[var(--reddb-spatial-control-height-lg)]",
        option: "px-[var(--reddb-spatial-inset-lg)] text-base leading-tight"
      }
    },
    // An error edges the whole group in the danger role, as an invalid Input
    // is edged; the separators between options keep the control edge.
    invalid: { true: { list: "border-feedback-danger-border" } },
    // What a group wider than its container does (ADR 0053). `scroll`, the
    // default, keeps one line that scrolls inside its own contour, and a
    // focused segment scrolls itself into view; `wrap` adds lines and keeps
    // every segment whole. `min-h` keeps either one Button tall at 100% text.
    // A wrapped group cannot keep one contour around ragged lines, so its
    // segments become separate chips: each draws its own edge and rounding,
    // a gap apart, and each line keeps the size's control height.
    overflow: {
      scroll: { list: "flex-nowrap overflow-x-auto overscroll-x-contain [scrollbar-width:thin]" },
      wrap: {
        list: "h-auto min-h-0 flex-wrap gap-[var(--reddb-spatial-gap-sm)] overflow-visible rounded-none border-0",
        option: "rounded-md first:rounded-md last:rounded-md border border-b-2 border-control-edge last:border-e"
      }
    }
  },
  compoundVariants: [
    { overflow: "wrap", size: "sm", class: { option: "min-h-[var(--reddb-spatial-control-height-sm)]" } },
    { overflow: "wrap", size: "md", class: { option: "min-h-[var(--reddb-spatial-control-height-md)]" } },
    { overflow: "wrap", size: "lg", class: { option: "min-h-[var(--reddb-spatial-control-height-lg)]" } }
  ],
  defaultVariants: { size: "md", overflow: "scroll" }
});
const TOGGLE_GROUP_OVERFLOWS = ["scroll", "wrap"];
const TOGGLE_GROUP_SIZES = ["sm", "md", "lg"];
export {
  TOGGLE_GROUP_OVERFLOWS,
  TOGGLE_GROUP_SIZES,
  toggleGroup
};
