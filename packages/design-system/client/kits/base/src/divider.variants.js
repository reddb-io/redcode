import { tv } from "tailwind-variants";
const DIVIDER_ORIENTATIONS = ["horizontal", "vertical"];
const divider = tv({
  base: "shrink-0 bg-muted",
  variants: {
    orientation: {
      horizontal: "my-[var(--reddb-spatial-gap-sm)] h-px w-full",
      vertical: "mx-[var(--reddb-spatial-gap-sm)] h-full w-px self-stretch"
    }
  },
  defaultVariants: { orientation: "horizontal" }
});
export {
  DIVIDER_ORIENTATIONS,
  divider
};
