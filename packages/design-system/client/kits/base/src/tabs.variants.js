import { tv } from "tailwind-variants";
const tabs = tv({
  slots: {
    root: "min-w-0",
    bar: "flex min-w-0 flex-wrap items-center gap-[var(--reddb-spatial-gap-sm)] border-b border-muted",
    list: "flex flex-wrap gap-[var(--reddb-spatial-gap-sm)] border-b border-muted",
    // The active tab wears the shared selection language (DESIGN.md,
    // "Interactive states"): a neutral surface, full-weight ink, and a 2px
    // ink underline on the edge it shares with the list's rule. Every
    // trigger carries the same 2px edge — transparent until active — so
    // selecting a tab moves nothing.
    trigger: [
      "-mb-px rounded-b-none border-0 border-b-2 border-transparent",
      "data-[state=active]:border-foreground data-[state=active]:bg-state-selected",
      "data-[state=active]:font-medium data-[state=active]:text-foreground",
      "data-[state=inactive]:text-ink-muted"
    ].join(" "),
    content: [
      "py-[var(--reddb-spatial-inset-md)] text-foreground",
      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    ].join(" ")
  },
  variants: {
    // Peers share a size (ADR 0054): each trigger is a Button of the Tabs'
    // `size`, held to that step's control height, so a tablist sits level
    // with the actions and fields of the same size beside it (ADR 0026).
    size: {
      sm: { trigger: "h-[var(--reddb-spatial-control-height-sm)]" },
      md: { trigger: "h-[var(--reddb-spatial-control-height-md)]" },
      lg: { trigger: "h-[var(--reddb-spatial-control-height-lg)]" }
    },
    // What a tab list wider than its container does (ADR 0053): `wrap`, the
    // default, adds lines; `scroll` keeps one line that scrolls, each tab whole.
    overflow: {
      wrap: {},
      scroll: { list: "flex-nowrap overflow-x-auto overscroll-x-contain [scrollbar-width:thin]", trigger: "shrink-0 whitespace-nowrap focus-visible:-outline-offset-2" }
    }
  },
  defaultVariants: { size: "sm", overflow: "wrap" }
});
const TABS_SIZES = ["sm", "md", "lg"];
export {
  TABS_SIZES,
  tabs
};
