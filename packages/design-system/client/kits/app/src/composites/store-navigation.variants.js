import { tv } from "tailwind-variants";
import { typeRoleMerge } from "@reddb-io/design-system/base/recipes";
const storeNavigation = tv({
  slots: {
    root: "isolate flex w-full flex-col bg-background text-foreground",
    announcement: [
      "flex min-h-[var(--reddb-spatial-control-height-sm)] items-center justify-center",
      "px-[var(--reddb-spatial-inset-md)] text-center text-body",
      "bg-primary text-on-primary"
    ].join(" "),
    navbar: "relative"
  }
}, typeRoleMerge);
export {
  storeNavigation
};
