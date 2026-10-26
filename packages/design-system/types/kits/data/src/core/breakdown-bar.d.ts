import { type ColorToken } from "./chart-color";
import type { ChartSeries } from "../chart";
export interface BreakdownItem {
    /** Stable group identity, retained through sorting and refreshes. */
    id: string;
    /** Visible group name. */
    label: string;
    /** Finite non-negative contribution to the total. Zero remains visible in the legend. */
    value: number;
    /** Explicit DS Series Role for identity across related charts. */
    series?: ChartSeries;
    /** Optional color custom-property name for this group. */
    color?: ColorToken;
}
export declare function breakdownItems(items: readonly BreakdownItem[]): {
    fraction: number;
    paint: string;
    /** Stable group identity, retained through sorting and refreshes. */
    id: string;
    /** Visible group name. */
    label: string;
    /** Finite non-negative contribution to the total. Zero remains visible in the legend. */
    value: number;
    /** Explicit DS Series Role for identity across related charts. */
    series?: ChartSeries;
    /** Optional color custom-property name for this group. */
    color?: ColorToken;
}[];
