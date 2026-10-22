import { tv } from "tailwind-variants";
const DEFAULT_ORDER_HISTORY_LABELS = {
  order: "Order",
  placed: "Placed",
  status: "Status",
  total: "Total"
};
const orderHistory = tv({
  slots: {
    root: "flex w-full flex-col min-w-0 gap-[var(--reddb-spatial-layout-gap-sm)]",
    heading: "pb-0"
  }
});
export {
  DEFAULT_ORDER_HISTORY_LABELS,
  orderHistory
};
