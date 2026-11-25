import { tv } from "tailwind-variants";
import { typeRoleMerge } from "./type-roles.js";
const HIT_AREA = [
  "relative before:absolute before:left-1/2 before:top-1/2 before:-translate-x-1/2 before:-translate-y-1/2",
  "before:h-[var(--reddb-spatial-target-min)] before:w-full before:min-w-[var(--reddb-spatial-target-min)]",
  // Every `before:` utility draws the pseudo-element (Tailwind 4 gives each
  // `content: var(--tw-content)`); this one removes it from a link that sits
  // directly in a text block, which is running text. Only the direct parent
  // counts: a figcaption's action row or a card's title wrapper holds a link
  // that stands on its own. Written out whole: Tailwind only generates classes
  // it finds as literals.
  "[:is(p,dd,figcaption,blockquote)>&]:before:content-none"
].join(" ");
const link = tv({
  base: [
    "text-foreground underline decoration-current underline-offset-[var(--reddb-spatial-gap-sm)]",
    "hover:decoration-2",
    HIT_AREA,
    "focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
  ].join(" ")
}, typeRoleMerge);
export {
  link
};
