export type { VisualizationSize, VisualizationSeries, } from "../../src/visualization";
export type { ScatterPoint } from "../../src/scatter";
import type { ScatterContract } from "../../src/core/contracts/scatter";
export interface ScatterProps extends ScatterContract {
    /** Reports selection for application-owned filtering or detail navigation. */
    onSelectedChange?: (id: string) => void;
    /** Extra classes on the outer figure. */
    className?: string;
}
export declare function Scatter(props: ScatterProps): import("react").JSX.Element;
export default Scatter;
