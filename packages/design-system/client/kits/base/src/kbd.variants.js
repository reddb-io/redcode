import { tv } from "tailwind-variants";
const SIZE = {
  sm: "h-4 min-w-4 px-1 text-xs",
  md: "h-5 min-w-5 px-1.5 text-xs"
};
const kbd = tv({
  base: "inline-flex items-center justify-center rounded-sm border border-muted bg-transparent font-mono leading-tight text-foreground whitespace-nowrap",
  variants: { size: SIZE },
  defaultVariants: { size: "md" }
});
const kbdChord = tv({
  slots: {
    root: "inline-flex items-center gap-[var(--reddb-spatial-gap-sm)] whitespace-nowrap",
    separator: "text-ink-muted text-xs"
  }
});
const KBD_SIZES = Object.keys(SIZE);
export {
  KBD_SIZES,
  kbd,
  kbdChord
};
