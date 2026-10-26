export type { VisualizationSize, VisualizationSeries, } from "../../src/visualization";
export type { SankeyData, SankeyNode, SankeyLink } from "../../src/sankey";
import type { SankeyContract } from "../../src/core/contracts/sankey";
export interface SankeyProps extends SankeyContract {
    /** Reports selection for application-owned filtering or detail navigation. */
    onSelectedChange?: (id: string) => void;
    /** Extra classes on the outer figure. */
    className?: string;
}
export declare function Sankey(props: SankeyProps): import("react").JSX.Element;
export default Sankey;
