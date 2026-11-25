import { tv } from "tailwind-variants";
import { typeRoleMerge } from "@reddb-io/design-system/base/recipes";
const pageHeading = tv({
  slots: {
    root: [
      "flex flex-wrap items-end justify-between",
      "gap-[var(--reddb-spatial-gap-lg)]",
      "border-b border-elevation-sunken-border bg-transparent pb-[var(--reddb-spatial-inset-md)]"
    ].join(" "),
    // A 20rem basis lets the actions wrap below the title before the identity
    // column is squeezed into a word-per-line strip on a phone.
    identity: "min-w-0 flex-[1_1_20rem]",
    context: "text-body text-ink-muted",
    // The page title is the Theme's `title` role, through the Base Heading
    // (ADR 0025): it follows the direction, never a size this file chose.
    title: "",
    description: "max-w-prose text-body text-ink-muted",
    actions: "flex flex-wrap items-center gap-[var(--reddb-spatial-gap-md)]"
  }
}, typeRoleMerge);
export {
  pageHeading
};
