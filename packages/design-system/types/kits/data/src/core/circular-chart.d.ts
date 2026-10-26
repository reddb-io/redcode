import { type ColorToken, type ChartPalette } from "./chart-color";
/** A nonnegative, independently selectable contribution. */
export interface PieSlice {
    /** Stable identity, retained across sorting and refresh. */
    id: string;
    /** Visible name of the contribution. */
    label: string;
    /** Observed nonnegative finite value. */
    value: number;
    /** Optional DS categorical role. */
    series?: 1 | 2 | 3 | 4 | 5 | 6;
    /** Optional color custom-property name. */
    color?: ColorToken;
}
/** Reading passed to a donut's custom center. */
export interface DonutReading {
    /** Total across all contributions, independent of selection. */
    total: number;
    /** Selected observed item, absent for the total view. */
    selected?: PieSlice;
    /** Current selected reading, or the total. */
    value: number;
    /** Selected share, or one hundred for a nonempty total. */
    percent: number;
}
export declare function circularModel(data: readonly PieSlice[], thickness: number | undefined, selected?: string | null, palette?: ChartPalette): {
    slices: {
        fraction: number;
        paint: string;
        path: string;
        centroid: [number, number];
        /** Stable identity, retained across sorting and refresh. */
        id: string;
        /** Visible name of the contribution. */
        label: string;
        /** Observed nonnegative finite value. */
        value: number;
        /** Optional DS categorical role. */
        series?: 1 | 2 | 3 | 4 | 5 | 6;
        /** Optional color custom-property name. */
        color?: ColorToken;
    }[];
    reading: DonutReading;
};
/** Move focus between actual graphical marks, without conflating focus and selection. */
export declare function circularFocus(event: KeyboardEvent): void;
