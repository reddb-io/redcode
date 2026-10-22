import { tv } from "tailwind-variants";
const SIZE = {
  sm: {
    root: "size-[var(--reddb-spatial-control-height-sm)] text-xs"
  },
  md: {
    root: "size-[var(--reddb-spatial-control-height-md)] text-sm"
  },
  lg: {
    root: "size-[var(--reddb-spatial-control-height-lg)] text-base"
  }
};
const avatar = tv({
  slots: {
    root: "relative inline-flex shrink-0 overflow-hidden rounded-full bg-muted text-foreground",
    image: "absolute inset-0 size-full object-cover",
    fallback: "flex size-full items-center justify-center font-medium"
  },
  variants: { size: SIZE },
  defaultVariants: { size: "md" }
});
const AVATAR_SIZES = Object.keys(SIZE);
export {
  AVATAR_SIZES,
  avatar
};
