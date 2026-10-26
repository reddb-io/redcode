import type { QuadrantContract } from "../../src/core/contracts/quadrant";
export type { VisualizationSize, VisualizationSeries } from "../../src/visualization";
export type { ScatterPoint, ScatterPoint as QuadrantPoint } from "../../src/scatter";
export type { ScatterScale, ScatterRegion } from "../../src/core/scatter-analysis";
export interface QuadrantProps extends QuadrantContract {
    /** Reports selection for application-owned filtering or detail navigation. */
    onSelectedChange?: (id: string) => void;
    /** Extra classes on the outer figure. */
    className?: string;
}
export declare function Quadrant(props: QuadrantProps): import("react").JSX.Element;
export default Quadrant;
