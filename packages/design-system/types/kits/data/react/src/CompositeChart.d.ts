import type { CompositeChartContract } from "../../src/core/contracts/compositechart";
export type { CompositeX, CompositePoint, CandlePoint, CompositeChartSeries, CompositeValueSeries, CompositeCandleSeries, CompositeAxis, CompositeReference } from "../../src/core/composite-chart";
export type { ChartSize, ChartSeries, ChartLayout, ChartReadout, ChartHeight, ChartTimestamp, ChartTimeRange } from "../../src/chart";
export type { ChartLoading } from "../../src/chart-loading";
export interface CompositeChartProps extends CompositeChartContract {
    /** Reports legend visibility changes from either presentation. */
    onHiddenSeriesChange?: (ids: readonly string[]) => void;
    /** Reports linked inspection as an epoch timestamp, or null to clear it. */
    onActiveXChange?: (value: number | null) => void;
    /** Reports maximization and dismissal. */
    onExpandedChange?: (expanded: boolean) => void;
    /** Extra classes on the chart's outer surface. */
    className?: string;
}
export declare function CompositeChart(props: CompositeChartProps): import("react").JSX.Element;
export default CompositeChart;
