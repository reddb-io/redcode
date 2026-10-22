import { tv } from "tailwind-variants";
import { dialog } from "./dialog.variants.js";
const DRAWER_SIDES = ["top", "right", "bottom", "left"];
const SIDE = {
  top: [
    "inset-x-0 top-0 bottom-auto w-full max-w-none",
    "motion-safe:not-open:-translate-y-full motion-safe:starting:open:-translate-y-full"
  ].join(" "),
  right: [
    "inset-y-0 right-0 left-auto h-full w-full max-w-md",
    "motion-safe:not-open:translate-x-full motion-safe:starting:open:translate-x-full"
  ].join(" "),
  bottom: [
    "inset-x-0 top-auto bottom-0 w-full max-w-none",
    "motion-safe:not-open:translate-y-full motion-safe:starting:open:translate-y-full"
  ].join(" "),
  left: [
    "inset-y-0 left-0 right-auto h-full w-full max-w-md",
    "motion-safe:not-open:-translate-x-full motion-safe:starting:open:-translate-x-full"
  ].join(" ")
};
const drawer = tv({
  base: [
    dialog(),
    // An over-tall sheet scrolls inside the viewport instead of running past it.
    "fixed m-0 max-h-full overflow-y-auto rounded-none",
    // `display` and `overlay` change discretely, so the panel stays painted in
    // the top layer until its slide out has finished.
    "motion-safe:transition-[translate,display,overlay] motion-safe:transition-discrete",
    "motion-safe:duration-[var(--reddb-duration-normal)] motion-safe:ease-exit motion-safe:open:ease-entrance"
  ].join(" "),
  variants: { side: SIDE },
  defaultVariants: { side: "right" }
});
export {
  DRAWER_SIDES,
  drawer
};
