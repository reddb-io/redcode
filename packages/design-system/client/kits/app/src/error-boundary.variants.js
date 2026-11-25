import { tv } from "tailwind-variants";
import { typeRoleMerge } from "@reddb-io/design-system/base/recipes";
const errorBoundary = tv(
  {
    slots: {
      root: "@container/error-boundary w-full grid min-w-0 justify-items-start gap-[var(--reddb-spatial-layout-gap-sm)] p-[var(--reddb-spatial-inset-md)] text-foreground",
      title: "m-0 text-heading wrap-break-word",
      description: "m-0 text-body text-ink-muted wrap-break-word"
    }
  },
  typeRoleMerge
);
export {
  errorBoundary
};
