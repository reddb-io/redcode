import { tv } from "tailwind-variants";
import { typeRoleMerge } from "@reddb-io/design-system/base/recipes";
const sidebarRail = tv({
  slots: {
    root: [
      "flex h-full min-h-0 w-[calc(var(--reddb-spatial-control-height-md)+2*var(--reddb-spatial-inset-sm))] min-w-[calc(var(--reddb-spatial-control-height-md)+2*var(--reddb-spatial-inset-sm)+1px)] shrink-0 flex-col items-center",
      "gap-[var(--reddb-spatial-gap-sm)] border-e border-elevation-sunken-border bg-elevation-sunken-surface shadow-elevation-sunken",
      "p-[var(--reddb-spatial-inset-sm)] text-foreground"
    ].join(" "),
    region: "flex w-full shrink-0 flex-col items-center gap-[var(--reddb-spatial-gap-md)]",
    // A classic scrollbar must not consume the icon's whole column and create
    // a second horizontal scrollbar. Wheel, touch and roving focus still
    // scroll this compact rail; ordinary content panels retain their scrollbar.
    middle: "min-h-0 w-[calc(100%+2*var(--reddb-spatial-gap-sm))] flex-1 -mx-[var(--reddb-spatial-gap-sm)] px-[var(--reddb-spatial-gap-sm)] py-[var(--reddb-spatial-gap-sm)] overflow-x-hidden overflow-y-auto [scrollbar-width:none]",
    badgeAnchor: "size-full items-center justify-center [&>[data-indicator-marker]]:translate-x-[var(--reddb-spatial-gap-sm)] [&>[data-indicator-marker]]:-translate-y-[var(--reddb-spatial-gap-sm)]",
    statusAnchor: "size-full items-center justify-center [&>[data-indicator-marker]]:translate-x-0 [&>[data-indicator-marker]]:translate-y-0",
    badge: "h-[var(--reddb-spatial-icon-size-md)] min-w-[var(--reddb-spatial-icon-size-md)] justify-center rounded-full p-0 tabular-nums",
    face: "inline-flex size-full shrink-0 items-center justify-center",
    // A label longer than the rail hyphenates (in the document's language)
    // and stops at two lines; the item's accessible name and tooltip carry
    // it in full (ADR 0052).
    label: "order-last line-clamp-2 max-w-full whitespace-normal hyphens-auto wrap-break-word text-center text-caption",
    divider: "mb-[var(--reddb-spatial-gap-md)]",
    list: "m-0 flex w-full list-none flex-col items-center gap-[var(--reddb-spatial-gap-md)] p-0",
    // The selected destination wears the shared selection language: neutral
    // surface, foreground ink, and a 2px ink start-edge bar (wave 6A) — never a red
    // outline. Every item carries the transparent edge so selection moves
    // nothing (DESIGN.md, "Interactive states").
    item: [
      "relative size-[var(--reddb-spatial-control-height-md)] shrink-0 overflow-visible rounded-s-none rounded-e-md border-0 border-s-2 border-transparent p-0",
      "text-label text-ink-muted hover:bg-state-hover hover:text-foreground",
      "aria-pressed:border-foreground aria-pressed:bg-state-selected aria-pressed:text-foreground aria-[current]:border-foreground aria-[current]:bg-state-selected aria-[current]:text-foreground",
      // Focus is the ink focus outline every DS control draws (ADR 0023),
      // drawn inside the item: the middle region scrolls, and the rail's
      // content box is exactly one item wide, so an outline outside the item
      // would be clipped on both sides by the scroll region.
      "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
    ].join(" "),
    fallback: "inline-flex size-full items-center justify-center"
  },
  variants: {
    labelled: {
      false: {},
      true: {
        // A typographic measure, independent of the fallback face's zero glyph.
        // ch changes during font loading and can wrap labels, moving the whole page.
        root: "w-[calc(max(6.65em,var(--reddb-spatial-control-height-md)*2)+2*var(--reddb-spatial-inset-sm))] text-caption",
        item: "h-auto min-h-[var(--reddb-spatial-control-height-lg)] w-full flex-col gap-[var(--reddb-spatial-gap-sm)] py-[var(--reddb-spatial-gap-sm)]",
        face: "size-[var(--reddb-spatial-control-height-md)]",
        // Let the whole item establish the badge's containing block. Presence
        // stays relative to the face through its own Indicator.
        badgeAnchor: "static [&>[data-indicator-marker]]:end-[calc(var(--reddb-spatial-gap-sm)/2)] [&>[data-indicator-marker]]:top-[calc(var(--reddb-spatial-gap-sm)/2)] [&>[data-indicator-marker]]:translate-x-0 [&>[data-indicator-marker]]:translate-y-0",
        region: "gap-[var(--reddb-spatial-layout-gap-sm)]",
        list: "gap-[var(--reddb-spatial-layout-gap-sm)] [&_[data-tooltip-root]]:w-full"
      }
    }
  },
  defaultVariants: { labelled: false }
}, typeRoleMerge);
export {
  sidebarRail
};
