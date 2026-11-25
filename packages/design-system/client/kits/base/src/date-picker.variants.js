import { tv } from "tailwind-variants";
const datePicker = tv({
  slots: {
    // The trigger wraps under the field when the row cannot hold both; the
    // field never shrinks below its segments, so its help text keeps the room.
    root: "flex min-w-0 flex-wrap items-end gap-[var(--reddb-spatial-gap-sm)]",
    field: "min-w-min flex-1",
    trigger: "shrink-0",
    // The calendar takes its own width (seven day squares), bounded by the
    // space beside the trigger that the Popover already respects.
    content: "w-fit",
    calendar: "border-0 p-0"
  }
});
export {
  datePicker
};
