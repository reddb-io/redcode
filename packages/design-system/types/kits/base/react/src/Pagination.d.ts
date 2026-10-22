import type { PaginationPage } from "../../src/core/pagination";
export type { PaginationPage } from "../../src/core/pagination";
export interface PaginationProps {
    /**
     * The page links in display order; each carries its page number and `href`, and `current`
     * marks the page being viewed.
     */
    pages: readonly PaginationPage[];
    /** Accessible name of the navigation landmark; defaults to `Pagination`. */
    label?: string;
    /** Extra classes, merged over the root slot's own. */
    className?: string;
}
export declare function Pagination({ pages, label, className }: PaginationProps): import("react").JSX.Element;
