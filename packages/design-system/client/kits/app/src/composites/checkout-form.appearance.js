import { tv } from "tailwind-variants";
const checkoutForm = tv({
  slots: {
    root: "w-full min-w-0",
    error: "m-0 font-medium text-feedback-danger-foreground",
    section: "min-w-0",
    actions: "flex flex-wrap items-center justify-end gap-[var(--reddb-spatial-gap-md)]"
  }
});
export {
  checkoutForm
};
