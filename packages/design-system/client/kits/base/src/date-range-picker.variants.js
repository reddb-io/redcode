import { tv } from "tailwind-variants";
const dateRangePicker = tv({
  slots: {
    root: "flex min-w-0 items-end gap-[var(--reddb-spatial-gap-sm)]",
    field: "min-w-0 flex-1",
    trigger: "shrink-0",
    calendar: "border-0 p-0"
  }
});
export {
  dateRangePicker
};
