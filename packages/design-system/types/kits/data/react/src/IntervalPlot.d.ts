import type { IntervalPlotContract } from "../../src/core/contracts/intervalplot";
export interface IntervalPlotProps extends IntervalPlotContract {
    onSelectedChange?: (id: string) => void;
    className?: string;
    onCollapsedChange?: (ids: readonly string[]) => void;
}
export declare function IntervalPlot(props: IntervalPlotProps): import("react").JSX.Element;
export default IntervalPlot;
