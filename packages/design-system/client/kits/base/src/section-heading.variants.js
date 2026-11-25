import { tv } from "tailwind-variants";
import { typeRoleMerge } from "./type-roles.js";
const SIZE = {
  sm: { title: "text-base font-medium leading-tight" },
  md: { title: "text-heading leading-tight" },
  lg: { title: "text-title font-medium leading-tight" },
  // The Theme's display role (ADR 0025): 5xl in Base and Application, and in
  // Marketing a size that grows to the Brand display tier with the heading's
  // own container width (ADR 0021) rather than the window's.
  display: {
    title: "text-display",
    description: "text-heading font-regular"
  }
};
const RULE = {
  true: { root: "border-b border-muted pb-[var(--reddb-spatial-inset-sm)]" },
  false: { root: "border-b border-transparent pb-0" }
};
const sectionHeading = tv({
  slots: {
    // A size container has no intrinsic width, so the heading spans its
    // section instead of collapsing in a shrink-to-fit parent.
    root: "@container/section-heading flex w-full flex-wrap items-end justify-between gap-[var(--reddb-spatial-gap-lg)]",
    // The title keeps a readable measure; actions that do not fit beside it
    // wrap below it instead of squeezing it (ADR 0052).
    group: "flex min-w-0 flex-[1_1_16rem] items-start gap-[var(--reddb-spatial-gap-md)]",
    leading: "shrink-0 text-ink-muted",
    text: "flex flex-col gap-[var(--reddb-spatial-gap-sm)]",
    // Weight and line height come with each size: the display role bundles
    // its own, which a shared class here would override.
    title: "text-foreground",
    description: "max-w-prose text-body text-ink-muted",
    actions: "flex max-w-full shrink-0 flex-wrap items-center gap-[var(--reddb-spatial-gap-md)]"
  },
  variants: { size: SIZE, rule: RULE },
  defaultVariants: { size: "md", rule: true }
}, typeRoleMerge);
const SECTION_HEADING_SIZES = Object.keys(SIZE);
const SECTION_HEADING_LEVELS = [1, 2, 3, 4, 5, 6];
export {
  SECTION_HEADING_LEVELS,
  SECTION_HEADING_SIZES,
  sectionHeading
};
