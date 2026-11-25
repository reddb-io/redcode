import type { DropdownMenuItem } from "./dropdown-menu";
import { type RowMeasure } from "./overflow";
/** One stable item in a native breadcrumb trail. */
export interface BreadcrumbItem {
    /** Stable item identity. */
    id: string;
    /** Visible destination name. */
    label: string;
    /** Link destination; omitted, the item is plain text. */
    href?: string;
    /** Marks the current page without linking it. */
    current?: boolean;
}
/**
 * Which crumbs of a measured trail move to "More" under `overflow="collapse"`
 * (ADR 0053): never the first crumb nor the current one (the last when none is
 * marked) and what follows it; the middle crumbs nearest the current page stay
 * while they fit.
 */
export declare function collapseBreadcrumbs(items: readonly BreadcrumbItem[], measure: RowMeasure): readonly number[];
/** Collapsed crumbs as "More" menu rows: a crumb with `href` stays a link; a plain-text crumb is a disabled row. */
export declare function breadcrumbMenuItems(items: readonly BreadcrumbItem[]): DropdownMenuItem<never>[];
