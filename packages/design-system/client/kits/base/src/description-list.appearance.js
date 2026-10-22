import { tv } from "tailwind-variants";
const GAP = {
  sm: "gap-[var(--reddb-spatial-gap-sm)]",
  md: "gap-[var(--reddb-spatial-gap-md)]",
  lg: "gap-[var(--reddb-spatial-gap-lg)]"
};
const descriptionList = tv({
  slots: {
    root: "@container/description-list grid",
    item: "grid @md/description-list:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]",
    term: "font-medium text-foreground",
    detail: "m-0 text-ink-muted"
  },
  variants: {
    gap: {
      sm: { root: GAP.sm, item: GAP.sm },
      md: { root: GAP.md, item: GAP.md },
      lg: { root: GAP.lg, item: GAP.lg }
    }
  },
  defaultVariants: { gap: "md" }
});
const DESCRIPTION_LIST_GAPS = Object.keys(GAP);
export {
  DESCRIPTION_LIST_GAPS,
  descriptionList
};
