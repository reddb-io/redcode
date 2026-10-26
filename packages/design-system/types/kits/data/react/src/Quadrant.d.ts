export type { VisualizationSize, VisualizationSeries, } from "../../src/visualization";
export type { ScatterPoint as QuadrantPoint } from "../../src/scatter";
import type { QuadrantContract } from "../../src/core/contracts/quadrant";
export interface QuadrantProps extends QuadrantContract {
    /** Reports selection for application-owned filtering or detail navigation. */
    onSelectedChange?: (id: string) => void;
    /** Extra classes on the outer figure. */
    className?: string;
}
export declare function Quadrant(props: QuadrantProps): import("react").JSX.Element;
export default Quadrant;
