import { type ResolvedTimeSeries, type TimeSeriesPoint } from "../../src/time-series";
import type { ChartCurve, ChartNumberFormat } from "../../src/chart";
interface TimeSeriesPlotProps {
    data: readonly TimeSeriesPoint[];
    datasets: readonly ResolvedTimeSeries[];
    domain: [number, number];
    samples: readonly (number | Date)[];
    valueDomain?: [number, number];
    cursor?: number | Date;
    formatX?: (value: number | Date) => string;
    variant: "line" | "area" | "stacked-area" | "bar";
    curve: ChartCurve;
    presentation: "full" | "minimal";
    barDomain: [number, number];
    format: ChartNumberFormat;
    baseline: number | undefined;
    width: number;
    height: number;
    padding: {
        top: number;
        right: number;
        bottom: number;
        left: number;
    };
}
export default function TimeSeriesPlot({ data, datasets, domain, samples, valueDomain, cursor, formatX, variant, curve, presentation, barDomain, format, baseline, width, height, padding, }: TimeSeriesPlotProps): import("react").JSX.Element;
export {};
