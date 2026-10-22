import { popover } from "@reddb-io/design-system/base";
import { tv } from "tailwind-variants";
const speedDial = tv({
  slots: {
    content: popover({
      class: "flex min-w-40 flex-col gap-[var(--reddb-spatial-gap-sm)] p-[var(--reddb-spatial-inset-sm)]"
    }),
    action: "w-full justify-start"
  },
  variants: {
    size: {
      sm: {},
      md: {},
      lg: {}
    }
  },
  defaultVariants: { size: "md" }
});
export {
  speedDial
};
