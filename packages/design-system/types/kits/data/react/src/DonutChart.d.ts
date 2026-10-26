import type { ReactNode } from "react";
import { type DonutReading } from "../../src/core/circular-chart";
import type { DonutChartContract } from "../../src/core/contracts/donutchart";
export type { PieSlice, DonutReading } from "../../src/core/circular-chart";
export interface DonutChartProps extends DonutChartContract {
    /** Noninteractive center; receives total and selected contribution. */
    center?: (reading: DonutReading) => ReactNode;
    /** Reports slice selection or clearing to the application. */
    onSelectedChange?: (id: string | null) => void;
    /** Reports opening or dismissing the expanded view. */
    onExpandedChange?: (expanded: boolean) => void;
    /** Extra classes on the figure. */
    className?: string;
}
export declare function DonutChart(props: DonutChartProps): import("react").JSX.Element;
export default DonutChart;
