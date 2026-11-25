import { tv } from "tailwind-variants";
import { typeRoleMerge } from "./type-roles.js";
const carousel = tv({
  slots: {
    root: "relative min-w-0",
    viewport: "overflow-hidden rounded-md",
    slide: "min-w-0",
    controls: [
      "mt-[var(--reddb-spatial-gap-sm)] flex flex-wrap items-center justify-between",
      "gap-[var(--reddb-spatial-gap-sm)]"
    ].join(" "),
    position: "text-body text-foreground",
    rotation: "ms-auto"
  }
}, typeRoleMerge);
export {
  carousel
};
