import { type ChartNumberFormat } from "../chart";
export type { ChartNumberFormat, ChartSeries, ChartSize } from "../chart";
export type { ChartLoading } from "../chart-loading";
export interface HistogramBin {
    x0: number;
    x1: number;
    label: string;
    count: number;
}
/**
 * Bin `values` into `requestedBins` equal-width bins. Each bin's label is its
 * edges in `format`, which defaults to just enough decimals to tell
 * neighbouring edges apart (`18–23.7`, never `18–23.666666666666668`).
 */
export declare function histogramBins(values: readonly number[], requestedBins?: number, format?: ChartNumberFormat): HistogramBin[];
