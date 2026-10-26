import type { Tone } from "@reddb-io/design-system/base";
export interface StatusCount {
    /** Stable state identity, independent of its localized label. */
    id: string;
    /** Visible state label. */
    label: string;
    /** Exact, non-negative integer count. */
    count: number;
    /** Semantic state tone, never inferred from the count. */
    tone?: Tone;
}
/** Resolves independent categorical counts without inventing an overall readiness state. */
export declare function statusCounts(items: readonly StatusCount[]): {
    total: number;
    items: {
        fraction: number;
        paint: string;
        /** Stable state identity, independent of its localized label. */
        id: string;
        /** Visible state label. */
        label: string;
        /** Exact, non-negative integer count. */
        count: number;
        /** Semantic state tone, never inferred from the count. */
        tone?: Tone;
    }[];
};
