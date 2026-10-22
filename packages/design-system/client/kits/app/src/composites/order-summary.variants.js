import { tv } from "tailwind-variants";
const orderSummary = tv({
  slots: {
    root: "w-full min-w-0",
    heading: "pb-0",
    content: "flex flex-col gap-[var(--reddb-spatial-layout-gap-sm)]",
    total: "flex items-center justify-between gap-[var(--reddb-spatial-gap-md)] font-medium",
    actions: "flex flex-wrap items-center justify-end gap-[var(--reddb-spatial-gap-md)]"
  }
});
export {
  orderSummary
};
