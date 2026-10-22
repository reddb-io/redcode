import { tv } from "tailwind-variants";
import { dialog } from "./dialog.variants.js";
const alertDialog = tv({
  base: [dialog(), "max-w-md"].join(" ")
});
const alertDialogActions = tv({
  base: [
    "mt-[var(--reddb-spatial-gap-lg)]",
    "flex flex-wrap justify-end gap-[var(--reddb-spatial-gap-md)]"
  ].join(" ")
});
export {
  alertDialog,
  alertDialogActions
};
