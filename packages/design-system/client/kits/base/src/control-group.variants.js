import { tv } from "tailwind-variants";
const CONTROL_GROUP_ORIENTATIONS = ["horizontal", "vertical"];
const controlGroup = tv({
  base: "flex gap-[var(--reddb-spatial-gap-sm)]",
  variants: {
    orientation: {
      horizontal: "flex-row flex-wrap items-center",
      vertical: "flex-col items-stretch"
    }
  },
  defaultVariants: {
    orientation: "horizontal"
  }
});
export {
  CONTROL_GROUP_ORIENTATIONS,
  controlGroup
};
