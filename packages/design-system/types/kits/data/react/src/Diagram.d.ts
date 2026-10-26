export type { VisualizationSize, VisualizationSeries, } from "../../src/visualization";
export type { DiagramData, DiagramNode, DiagramEdge } from "../../src/diagram";
import type { DiagramContract } from "../../src/core/contracts/diagram";
export interface DiagramProps extends DiagramContract {
    /** Reports selection for application-owned filtering or detail navigation. */
    onSelectedChange?: (id: string) => void;
    /** Extra classes on the outer figure. */
    className?: string;
}
export declare function Diagram(props: DiagramProps): import("react").JSX.Element;
export default Diagram;
