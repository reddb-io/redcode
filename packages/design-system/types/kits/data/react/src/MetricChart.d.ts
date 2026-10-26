import type { MetricChartContract } from "../../src/core/contracts/metricchart";
export interface MetricChartProps extends MetricChartContract {
    /** Reports expansion changes. */
    onExpandedChange?: (open: boolean) => void;
    /** Reports legend visibility shared by both views. */
    onHiddenSeriesChange?: (ids: readonly string[]) => void;
    /** Reports linked inspection as an epoch timestamp, or null to clear it. */
    onActiveXChange?: (value: number | null) => void;
    /** Additional metric surface classes. */
    className?: string;
}
export declare function MetricChart(props: MetricChartProps): import("react").JSX.Element;
export default MetricChart;
