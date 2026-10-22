import { tv } from "tailwind-variants";
const GAP = {
  sm: "gap-[var(--reddb-spatial-gap-sm)]",
  md: "gap-[var(--reddb-spatial-gap-md)]",
  lg: "gap-[var(--reddb-spatial-gap-lg)]"
};
const list = tv({
  base: "flex flex-col",
  variants: { gap: GAP },
  defaultVariants: { gap: "md" }
});
const LIST_GAPS = Object.keys(GAP);
export {
  LIST_GAPS,
  list
};
