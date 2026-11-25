import { tv } from "tailwind-variants";
import { typeRoleMerge } from "./type-roles.js";
const pagination = tv({
  slots: {
    root: "text-foreground",
    list: "m-0 flex list-none flex-wrap items-center gap-[var(--reddb-spatial-gap-sm)] ps-0",
    page: [
      "inline-flex h-[var(--reddb-spatial-control-height-sm)] min-w-[var(--reddb-spatial-control-height-sm)]",
      "items-center justify-center rounded-md border border-control-edge px-[var(--reddb-spatial-inset-sm)]",
      // The current page wears the shared selection language: a neutral
      // surface, full-weight ink, and a 2px ink underline — not a red
      // outline (DESIGN.md, "Interactive states").
      "aria-[current=page]:border-b-2 aria-[current=page]:border-b-foreground aria-[current=page]:bg-state-selected",
      "aria-[current=page]:font-medium aria-[current=page]:text-foreground"
    ].join(" ")
  },
  variants: {
    // With Previous/Next or a status, the controls and the list share one row
    // that wraps (ADR 0053); the list may shrink so its pages wrap, not overflow.
    stepped: {
      true: {
        root: "flex flex-wrap items-center gap-[var(--reddb-spatial-gap-sm)]",
        list: "min-w-0"
      }
    }
  }
}, typeRoleMerge);
export {
  pagination
};
