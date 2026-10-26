export type { ChartCurve, ChartNumberFormat, ChartSeries, ChartSize, ChartLayout, ChartReadout, ChartHeight, ChartTimestamp, ChartTimeRange, } from "../../src/chart";
export type { ChartLoading } from "../../src/chart-loading";
export type { TimeSeriesPoint, TimeSeriesDataset } from "../../src/time-series";
export type { TimeSeriesVariant } from "../../src/time-series";
import type { TimeSeriesContract } from "../../src/core/contracts/timeseries";
export interface TimeSeriesProps extends TimeSeriesContract {
    /** Called after a legend action changes hidden dataset ids. */
    onHiddenSeriesChange?: (ids: readonly string[]) => void;
    /** Reports linked inspection as an epoch timestamp, or null to clear it. */
    onActiveXChange?: (value: number | null) => void;
    /** Extra classes, merged onto the chart's root `figure`. */
    className?: string;
}
export declare function TimeSeries(props: TimeSeriesProps): import("react").JSX.Element;
export default TimeSeries;
