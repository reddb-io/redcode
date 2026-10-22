import { dropdownMenu, popover } from "@reddb-io/design-system/base";
import { tv } from "tailwind-variants";
const menubar = tv({
  extend: dropdownMenu,
  slots: {
    root: "flex items-center gap-[var(--reddb-spatial-gap-sm)] data-[command-menubar]:items-center",
    content: popover({ class: "min-w-48 p-[var(--reddb-spatial-inset-sm)]" })
  }
});
export {
  menubar
};
