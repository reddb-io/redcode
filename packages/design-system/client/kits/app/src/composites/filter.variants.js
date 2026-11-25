import { tv } from "tailwind-variants";
const filter = tv({
  slots: {
    root: "min-w-0 w-full",
    // Filters are a chip row: Filter asks its ToggleGroup to wrap rather
    // than scroll options out of sight (ADR 0053).
    list: "gap-[var(--reddb-spatial-gap-sm)]"
  }
});
export {
  filter
};
