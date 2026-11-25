import { tv } from "tailwind-variants";
import { typeRoleMerge } from "./type-roles.js";
const accordion = tv({
  slots: {
    root: "min-w-0 divide-y divide-muted border-y border-muted",
    item: "min-w-0",
    header: "m-0",
    // `group` is what the indicator's expanded-state rotation reads.
    trigger: [
      "group min-h-[var(--reddb-spatial-control-height-sm)] w-full justify-between rounded-none px-0 text-left",
      "data-[state=open]:text-foreground"
    ].join(" "),
    label: "min-w-0 truncate",
    // The chevron is a glyph beside the trigger's label, so it follows the
    // label role through Button's pairing (ADR 0054).
    indicator: "ml-auto inline-flex shrink-0 text-ink-muted transition-transform group-aria-expanded:rotate-180 motion-reduce:transition-none",
    content: "overflow-hidden pb-[var(--reddb-spatial-inset-md)] text-foreground"
  }
}, typeRoleMerge);
export {
  accordion
};
