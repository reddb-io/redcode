import { tv } from "tailwind-variants";
const datePicker = tv({
  slots: {
    root: "flex min-w-0 items-end gap-[var(--reddb-spatial-gap-sm)]",
    field: "min-w-0 flex-1",
    trigger: "shrink-0",
    content: "w-fit max-w-none",
    calendar: "border-0 p-0"
  }
});
export {
  datePicker
};
