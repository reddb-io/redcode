import { type BreadcrumbItem } from "../../src/core/breadcrumbs";
import { type CollapsibleRowOverflow } from "../../src/core/overflow";
export type { BreadcrumbItem } from "../../src/core/breadcrumbs";
export interface BreadcrumbsProps {
    /**
     * The trail in order. An item with `current` marks the page you are on; one without `href` is
     * plain text.
     */
    items: readonly BreadcrumbItem[];
    /** Accessible name of the navigation landmark. Defaults to `Breadcrumbs`. */
    label?: string;
    /**
     * Opt in to emitting the trail as a schema.org `BreadcrumbList` JSON-LD block (ADR 0028).
     * `true` keeps each `href` as written; `{ origin }` resolves root-relative hrefs to absolute
     * URLs, which search engines expect. Defaults to `false`, so a page that already emits the
     * trail elsewhere never emits it twice.
     */
    structuredData?: boolean | {
        origin: string;
    };
    /**
     * What the trail does when it does not fit (ADR 0053): `wrap` adds lines, or `collapse` keeps
     * one line, measures it and moves the middle crumbs into a labelled "More" menu, always keeping
     * the first crumb and the current one. A collapsing trail takes the full width its container
     * gives it. Defaults to `collapse` (ADR 0053).
     */
    overflow?: CollapsibleRowOverflow;
    /** Accessible name and visible text of the "More" menu trigger when crumbs collapse. Defaults to `More`. */
    moreLabel?: string;
    /** Extra classes merged onto the `nav` root. */
    className?: string;
}
export declare function Breadcrumbs({ items, label, structuredData, overflow, moreLabel, className }: BreadcrumbsProps): import("react").JSX.Element;
