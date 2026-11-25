import { tv } from "tailwind-variants";
const hitArea = tv({
  base: "relative before:absolute before:left-1/2 before:top-1/2 before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']",
  variants: {
    axis: {
      /** Both dimensions reach the floor: a glyph-only or dismiss control. */
      both: "before:h-full before:min-h-[var(--reddb-spatial-target-min)] before:w-full before:min-w-[var(--reddb-spatial-target-min)]",
      /** Only the block size: an inline link whose width is its words. */
      block: "before:h-[var(--reddb-spatial-target-min)] before:w-full"
    }
  },
  defaultVariants: { axis: "both" }
});
export {
  hitArea
};
