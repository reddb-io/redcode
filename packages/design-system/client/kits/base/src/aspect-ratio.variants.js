import { tv } from "tailwind-variants";
const DEFAULT_ASPECT_RATIO = 16 / 9;
const aspectRatio = tv({
  base: [
    "relative box-border w-full overflow-hidden",
    "p-[var(--reddb-spatial-inset-sm)]",
    "[&>*]:h-full [&>*]:w-full"
  ].join(" ")
});
export {
  DEFAULT_ASPECT_RATIO,
  aspectRatio
};
