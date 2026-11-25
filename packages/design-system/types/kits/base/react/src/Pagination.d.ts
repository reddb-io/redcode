import { type PaginationPage } from "../../src/core/pagination";
export type { PaginationPage } from "../../src/core/pagination";
export interface PaginationProps {
    /**
     * The pages in display order; each carries its page number, an `href` when it is a link,
     * and `current` marks the page being viewed.
     */
    pages: readonly PaginationPage[];
    /** Accessible name of the navigation landmark; defaults to `Pagination`. */
    label?: string;
    /**
     * Reports the page a person chose. Given, every page is a button that calls it instead of a
     * link, for state-local pagers such as the Data `DataTable`.
     */
    onPageChange?: (page: number) => void;
    /** Visible name of a Previous button before the pages; with `onPageChange` only. Disabled on the first page. */
    previousLabel?: string;
    /** Visible name of a Next button after the pages; with `onPageChange` only. Disabled on the last page. */
    nextLabel?: string;
    /** Total number of pages, so Next disables on the last page when `pages` lists only a window. Defaults to the highest listed page. */
    pageCount?: number;
    /** Polite live text after the controls announcing the position, such as `Page 2 of 9`. */
    status?: string;
    /** Extra classes, merged over the root slot's own. */
    className?: string;
}
export declare function Pagination({ pages, label, onPageChange, previousLabel, nextLabel, pageCount, status, className }: PaginationProps): import("react").JSX.Element;
