import type { BreadcrumbItem } from "../../src/core/breadcrumbs";
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
    /** Extra classes merged onto the `nav` root. */
    className?: string;
}
export declare function Breadcrumbs({ items, label, structuredData, className }: BreadcrumbsProps): import("react").JSX.Element;
