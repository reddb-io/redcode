import { tv } from "tailwind-variants";
const ORIENTATION = {
  vertical: "overflow-x-hidden overflow-y-auto",
  horizontal: "overflow-x-auto overflow-y-hidden",
  both: "overflow-auto"
};
const scrollArea = tv({
  base: [
    "relative text-foreground",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
  ].join(" "),
  variants: {
    orientation: ORIENTATION,
    variant: {
      outline: "rounded-md border border-muted bg-background p-[var(--reddb-spatial-inset-sm)]",
      plain: "p-0 focus-visible:-outline-offset-2"
    }
  },
  defaultVariants: { orientation: "vertical", variant: "outline" }
});
const SCROLL_AREA_ORIENTATIONS = Object.keys(
  ORIENTATION
);
export {
  SCROLL_AREA_ORIENTATIONS,
  scrollArea
};
