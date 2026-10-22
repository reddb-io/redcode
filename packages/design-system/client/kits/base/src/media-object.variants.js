import { tv } from "tailwind-variants";
const ALIGN = {
  start: { root: "items-start" },
  center: { root: "items-center" },
  end: { root: "items-end" }
};
const GAP = {
  sm: { root: "gap-[var(--reddb-spatial-gap-sm)]" },
  md: { root: "gap-[var(--reddb-spatial-gap-md)]" },
  lg: { root: "gap-[var(--reddb-spatial-gap-lg)]" }
};
const mediaObject = tv({
  slots: {
    root: "flex min-w-0",
    media: "shrink-0",
    content: "min-w-0 flex-1"
  },
  variants: { align: ALIGN, gap: GAP },
  defaultVariants: { align: "start", gap: "md" }
});
export {
  mediaObject
};
