import type { PieChartContract } from "../../src/core/contracts/piechart";
export type { PieSlice, DonutReading } from "../../src/core/circular-chart";
export interface PieChartProps extends PieChartContract {
    /** Reports slice selection or clearing to the application. */
    onSelectedChange?: (id: string | null) => void;
    /** Reports opening or dismissing the expanded view. */
    onExpandedChange?: (expanded: boolean) => void;
    /** Extra classes on the figure. */
    className?: string;
}
export declare function PieChart(props: PieChartProps): import("react").JSX.Element;
export default PieChart;
