import type { CandlestickContract } from "../../src/core/contracts/candlestick";
export type { CandlePoint, CompositeValueSeries, CompositeAxis, CompositeReference } from "../../src/core/composite-chart";
export type { ChartSeries, ChartSize, ChartLayout, ChartReadout, ChartHeight, ChartTimestamp, ChartTimeRange } from "../../src/chart";
export interface CandlestickProps extends CandlestickContract {
    /** Reports legend visibility changes from either presentation. */
    onHiddenSeriesChange?: (ids: readonly string[]) => void;
    /** Reports linked inspection as an epoch timestamp, or null to clear it. */
    onActiveXChange?: (value: number | null) => void;
    /** Reports maximization and dismissal. */
    onExpandedChange?: (expanded: boolean) => void;
    /** Extra classes on the chart's outer surface. */
    className?: string;
}
export declare function Candlestick(props: CandlestickProps): import("react").JSX.Element;
export default Candlestick;
