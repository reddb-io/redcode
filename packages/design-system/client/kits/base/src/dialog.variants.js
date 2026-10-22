import { tv } from "tailwind-variants";
const dialog = tv({
  base: [
    "m-auto w-full rounded-lg border border-elevation-overlay-border bg-elevation-overlay-surface text-foreground shadow-elevation-overlay",
    "p-[var(--reddb-spatial-inset-lg)]",
    "focus:outline-hidden",
    "backdrop:bg-scrim/60",
    "motion-safe:transition-opacity motion-reduce:transition-none"
  ].join(" "),
  variants: {
    size: {
      sm: "max-w-sm",
      md: "max-w-lg",
      lg: "max-w-2xl",
      xl: "max-w-[var(--reddb-container-wide)]"
    }
  },
  defaultVariants: { size: "md" }
});
const dialogClose = tv({
  base: "absolute top-[var(--reddb-spatial-inset-sm)] right-[var(--reddb-spatial-inset-sm)]"
});
const DIALOG_SIZES = ["sm", "md", "lg", "xl"];
export {
  DIALOG_SIZES,
  dialog,
  dialogClose
};
