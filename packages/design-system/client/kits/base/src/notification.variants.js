import { tv } from "tailwind-variants";
const notification = tv({
  slots: {
    root: "flex w-full max-w-sm items-start gap-[var(--reddb-spatial-gap-sm)]",
    announcement: "min-w-0 flex-1",
    dismiss: "shrink-0"
  }
});
export {
  notification
};
