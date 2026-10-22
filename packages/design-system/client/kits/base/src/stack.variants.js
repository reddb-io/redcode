import { tv } from "tailwind-variants";
const GAP = {
  none: "gap-0",
  sm: "gap-[var(--reddb-spatial-gap-sm)]",
  md: "gap-[var(--reddb-spatial-gap-md)]",
  lg: "gap-[var(--reddb-spatial-gap-lg)]",
  "layout-sm": "gap-[var(--reddb-spatial-layout-gap-sm)]",
  "layout-md": "gap-[var(--reddb-spatial-layout-gap-md)]",
  "layout-lg": "gap-[var(--reddb-spatial-layout-gap-lg)]",
  section: "gap-[var(--reddb-spatial-section-gap)]"
};
const DIRECTION = {
  column: "flex-col",
  row: "flex-row"
};
const ALIGN = {
  stretch: "",
  start: "items-start",
  center: "items-center",
  end: "items-end",
  baseline: "items-baseline"
};
const JUSTIFY = {
  start: "",
  center: "justify-center",
  end: "justify-end",
  between: "justify-between"
};
const WRAP = {
  true: "flex-wrap",
  false: ""
};
const stack = tv({
  base: "flex",
  variants: { direction: DIRECTION, gap: GAP, align: ALIGN, justify: JUSTIFY, wrap: WRAP },
  defaultVariants: { direction: "column", gap: "layout-md", align: "stretch", justify: "start", wrap: false }
});
const STACK_GAPS = Object.keys(GAP);
const STACK_DIRECTIONS = Object.keys(DIRECTION);
const STACK_ALIGNMENTS = Object.keys(ALIGN);
const STACK_JUSTIFICATIONS = Object.keys(JUSTIFY);
export {
  STACK_ALIGNMENTS,
  STACK_DIRECTIONS,
  STACK_GAPS,
  STACK_JUSTIFICATIONS,
  stack
};
