import { tv } from "tailwind-variants";
import { typeRoleMerge } from "./type-roles.js";
const ALIGN = {
  start: {
    brand: "shrink-0",
    links: "grow justify-start",
    actions: "ms-auto shrink-0 justify-end"
  },
  center: {
    brand: "grow basis-0 justify-start",
    links: "shrink-0 justify-center",
    actions: "grow basis-0 justify-end"
  }
};
const COLLAPSE = {
  responsive: {
    rail: "hidden @3xl/navbar:flex",
    compact: "flex @3xl/navbar:hidden",
    panel: "@3xl/navbar:hidden"
  },
  expanded: { rail: "flex", compact: "hidden", panel: "hidden" },
  collapsed: { rail: "hidden", compact: "flex", panel: "" }
};
const OPEN = {
  true: { panel: "flex" },
  false: { panel: "hidden" }
};
const navbar = tv({
  slots: {
    root: "@container/navbar flex w-full flex-col border-b border-muted bg-navigation-surface font-sans text-body text-foreground",
    rail: [
      "min-h-[var(--reddb-spatial-control-height-lg)] w-full flex-1 items-center gap-[var(--reddb-spatial-gap-lg)]",
      "px-[var(--reddb-spatial-inset-md)]"
    ].join(" "),
    compact: [
      "min-h-[var(--reddb-spatial-control-height-lg)] w-full flex-1 items-center justify-between gap-[var(--reddb-spatial-gap-md)]",
      "px-[var(--reddb-spatial-inset-md)]"
    ].join(" "),
    brand: "flex items-center",
    links: "m-0 flex list-none items-stretch self-stretch gap-[var(--reddb-spatial-gap-sm)] ps-0",
    item: "flex items-stretch",
    actions: "flex items-center gap-[var(--reddb-spatial-gap-md)]",
    // Destinations in a masthead read as navigation, not as prose links: muted
    // ink, no underline, and the current one wears the shared selection
    // language — neutral surface, full-weight ink, and a 2px ink
    // underline on the rail (a start-edge bar in the stacked panel below).
    // Every link carries the transparent edge so marking one moves nothing.
    link: [
      "inline-flex h-auto min-h-[var(--reddb-spatial-control-height-lg)] w-auto items-center rounded-none border-b-2 border-transparent",
      "px-[var(--reddb-spatial-inset-md)] text-body font-medium leading-tight text-ink-muted no-underline",
      "aria-[current]:border-foreground aria-[current]:bg-foreground/10 aria-[current]:font-medium aria-[current]:text-foreground"
    ].join(" "),
    panelLink: [
      "flex min-h-[var(--reddb-spatial-control-height-md)] w-full items-center justify-start rounded-s-none border-s-2 border-transparent",
      "px-[var(--reddb-spatial-inset-md)] text-body font-medium text-ink-muted no-underline",
      "aria-[current]:border-foreground aria-[current]:bg-foreground/10 aria-[current]:font-medium aria-[current]:text-foreground"
    ].join(" "),
    toggle: "shrink-0",
    panel: [
      "w-full flex-col gap-[var(--reddb-spatial-gap-md)] border-t border-muted",
      "px-[var(--reddb-spatial-inset-md)] py-[var(--reddb-spatial-inset-md)]"
    ].join(" "),
    panelLinks: "m-0 flex list-none flex-col gap-[var(--reddb-spatial-gap-sm)] ps-0"
  },
  variants: { align: ALIGN, collapse: COLLAPSE, open: OPEN },
  defaultVariants: { align: "start", collapse: "responsive", open: false }
}, typeRoleMerge);
export {
  navbar
};
