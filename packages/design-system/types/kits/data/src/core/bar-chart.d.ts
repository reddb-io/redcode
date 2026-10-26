import type { CompositeValueSeries } from "./composite-chart";
import { type ChartPalette, type ColorToken } from "./chart-color";
/** One stable comparison category. */
export interface BarCategory {
    /** Unique category identity. */
    id: string;
    /** Full category label. */
    label: string;
    /** Single observation; use values for grouped or stacked observations. */
    value?: number | null;
    /** Observations keyed by declared series id; missing entries remain gaps. */
    values?: Readonly<Record<string, number | null>>;
    /** Color token for a single-series category. */
    color?: ColorToken;
}
/** A named contribution present across comparison categories. */
export interface BarSeries {
    /** Stable identity matching each category's values. */
    id: string;
    /** Legend name. */
    label: string;
    /** Optional categorical role. */
    series?: 1 | 2 | 3 | 4 | 5 | 6;
    /** Optional color token. */
    color?: ColorToken;
}
export declare function barModel(data: readonly BarCategory[], series?: readonly BarSeries[], sort?: "input" | "ascending" | "descending", palette?: ChartPalette): {
    categories: BarCategory[];
    layers: CompositeValueSeries[];
    formatX: (value: string | number | Date) => string;
};
