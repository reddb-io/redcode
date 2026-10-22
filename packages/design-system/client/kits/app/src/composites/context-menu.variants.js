import { dropdownMenu, popover } from "@reddb-io/design-system/base/recipes";
import { tv } from "tailwind-variants";
const contextMenu = tv({
  extend: dropdownMenu,
  slots: {
    content: popover({
      class: "min-w-48 p-[var(--reddb-spatial-inset-sm)] data-[state=open]:outline-hidden"
    })
  }
});
export {
  contextMenu
};
