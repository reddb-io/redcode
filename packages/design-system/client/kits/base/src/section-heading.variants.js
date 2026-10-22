import { tv } from "tailwind-variants";
import { typeRoleMerge } from "./type-roles.js";
const SIZE = {
  sm: { title: "text-base font-medium leading-tight" },
  md: { title: "text-lg font-medium leading-tight" },
  lg: { title: "text-2xl font-medium leading-tight" },
  // The Theme's display role (ADR 0025): 5xl in Base and Application, and in
  // Marketing a size that grows to the Brand display tier with the heading's
  // own container width (ADR 0021) rather than the window's.
  display: {
    title: "text-display",
    description: "text-lg"
  }
};
const RULE = {
  true: { root: "border-b border-muted pb-[var(--reddb-spatial-inset-sm)]" },
  false: { root: "border-b border-transparent pb-0" }
};
const sectionHeading = tv({
  slots: {
    root: "@container/section-heading flex flex-wrap items-end justify-between gap-[var(--reddb-spatial-gap-lg)]",
    text: "flex flex-col gap-[var(--reddb-spatial-gap-sm)]",
    // Weight and line height come with each size: the display role bundles
    // its own, which a shared class here would override.
    title: "text-foreground",
    description: "max-w-prose text-sm text-ink-muted",
    actions: "flex flex-wrap items-center gap-[var(--reddb-spatial-gap-md)]"
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
