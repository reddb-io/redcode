import type { ReactNode } from "react";
import { type BarCategory } from "../../src/core/bar-chart";
import type { BarChartContract } from "../../src/core/contracts/barchart";
export type { BarCategory, BarSeries } from "../../src/core/bar-chart";
export interface BarChartProps extends BarChartContract {
    /** Optional noninteractive category identity, such as an avatar and name, displayed below the plot. */
    category?: (item: BarCategory) => ReactNode;
    /** Reports series visibility changes. */
    onHiddenSeriesChange?: (ids: readonly string[]) => void;
    /** Reports opening or dismissing the maximized plot. */
    onExpandedChange?: (expanded: boolean) => void;
    /** Reports linked sample inspection. */
    onActiveXChange?: (value: number | null) => void;
    /** Extra classes on the chart. */
    className?: string;
}
export declare function BarChart(props: BarChartProps): import("react").JSX.Element;
export default BarChart;
