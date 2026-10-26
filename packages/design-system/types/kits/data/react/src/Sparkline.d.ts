import type { SparklineContract } from "../../src/core/contracts/sparkline";
export type { ChartCurve, ChartSeries, SparklineVariant, } from "../../src/chart";
export type { ChartLoading } from "../../src/chart-loading";
export interface SparklineProps extends SparklineContract {
    /** Extra classes merged onto the chart's root figure. */
    className?: string;
}
export declare function Sparkline({ values, label, strokeWidth, series, color, variant, curve, width, height, loading, className, }: SparklineProps): import("react").JSX.Element;
export default Sparkline;
