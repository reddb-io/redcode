import type { ResolvedTimeSeries } from "./time-series";
/** Statistics over observed samples; missing timestamps never become invented zeroes. */
export declare function metricStatistics(datasets: readonly ResolvedTimeSeries[]): {
    id: string;
    label: string;
    paint: string;
    count: number;
    min: number | null;
    max: number | null;
    average: number | null;
    total: number | null;
    last: number | null;
}[];
