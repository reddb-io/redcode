import { tv } from "tailwind-variants";
const stateIllustration = tv({
  base: "block h-auto max-w-full shrink-0",
  variants: { size: {
    sm: "w-[calc(var(--reddb-spatial-control-height-md)*5)]",
    md: "w-[calc(var(--reddb-spatial-control-height-md)*8)]",
    lg: "w-[calc(var(--reddb-spatial-control-height-md)*12)]",
    full: "w-full"
  } },
  defaultVariants: { size: "md" }
});
const STATE_ILLUSTRATION_SIZES = ["sm", "md", "lg", "full"];
export {
  STATE_ILLUSTRATION_SIZES,
  stateIllustration
};
