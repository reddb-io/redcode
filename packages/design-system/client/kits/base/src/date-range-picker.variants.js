import { tv } from "tailwind-variants";
const dateRangePicker = tv({
  slots: {
    // The range pair is a size container with no width of its own, so the
    // row takes the width it is given rather than shrinking to its trigger.
    // A size container also has no min-content, so the field asks for the
    // width of one date's segments as its basis: where the row cannot hold
    // that and the trigger, the trigger wraps below instead of covering them.
    root: "flex w-full min-w-0 flex-wrap items-end gap-[var(--reddb-spatial-gap-sm)]",
    field: "min-w-0 flex-[1_1_calc(var(--reddb-spatial-control-height-md)*7)]",
    trigger: "shrink-0",
    // As DatePicker: the calendar sets the width, so a day keeps its square
    // (44px under touch) instead of fitting the Popover's default 20rem.
    content: "w-fit",
    calendar: "border-0 p-0"
  }
});
export {
  dateRangePicker
};
