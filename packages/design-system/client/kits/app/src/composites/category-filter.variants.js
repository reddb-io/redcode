import { tv } from "tailwind-variants";
const categoryFilter = tv({
  slots: {
    root: "min-w-0",
    list: "grid w-full gap-[var(--reddb-spatial-gap-sm)]",
    option: "min-w-0"
  }
});
export {
  categoryFilter
};
