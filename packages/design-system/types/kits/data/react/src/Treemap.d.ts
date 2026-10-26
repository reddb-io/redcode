export type { VisualizationSize, VisualizationSeries, } from "../../src/visualization";
export type { TreemapNode } from "../../src/treemap";
import type { TreemapContract } from "../../src/core/contracts/treemap";
export interface TreemapProps extends TreemapContract {
    /** Reports selection for application-owned filtering or detail navigation. */
    onSelectedChange?: (id: string) => void;
    /** Extra classes on the outer figure. */
    className?: string;
}
export declare function Treemap(props: TreemapProps): import("react").JSX.Element;
export default Treemap;
