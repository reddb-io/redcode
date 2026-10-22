import { tv } from "tailwind-variants";
const SIZE = {
  prose: "max-w-prose",
  content: "max-w-content",
  wide: "max-w-wide",
  full: "max-w-none"
};
const container = tv({
  base: "mx-auto box-border w-full px-[var(--reddb-spatial-inset-md)]",
  variants: { size: SIZE },
  defaultVariants: { size: "wide" }
});
const CONTAINER_SIZES = Object.keys(SIZE);
export {
  CONTAINER_SIZES,
  container
};
