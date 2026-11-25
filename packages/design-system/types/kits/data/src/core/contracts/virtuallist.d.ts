import type { CollectionStateContract } from "@reddb-io/design-system/base";
/** Portable virtualization properties shared by native adapters; its state follows the shared collection contract (ADR 0056). */
export interface VirtualListContract<T> extends CollectionStateContract {
    /** Accessible name of the keyboard-scrollable list region. */
    label: string;
    /** Complete application-owned collection after filtering and ordering. */
    items: readonly T[];
    /** Stable unique identity; changing indices must not change an item's key. */
    rowKey: (item: T) => string;
    /** Fixed row height as a positive multiple of the current Density control height. */
    rowUnits?: number;
    /** Positive number of rows that fit in the viewport. */
    visibleRows?: number;
    /** Extra rows mounted on each side of the viewport. */
    overscan?: number;
    /** Visible empty-collection message. */
    emptyLabel?: string;
}
