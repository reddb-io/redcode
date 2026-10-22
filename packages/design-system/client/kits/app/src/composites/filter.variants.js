import { tv } from "tailwind-variants";
const filter = tv({
  slots: {
    root: "min-w-0 w-full",
    list: "gap-[var(--reddb-spatial-gap-sm)]"
  }
});
export {
  filter
};
