export type { VisualizationSize, VisualizationSeries, } from "../../src/visualization";
export type { ExplodedLayer } from "../../src/exploded-layers";
import type { ExplodedLayersContract } from "../../src/core/contracts/explodedlayers";
export interface ExplodedLayersProps extends ExplodedLayersContract {
    /** Reports selection for application-owned filtering or detail navigation. */
    onSelectedChange?: (id: string) => void;
    /** Extra classes on the outer figure. */
    className?: string;
}
export declare function ExplodedLayers(props: ExplodedLayersProps): import("react").JSX.Element;
export default ExplodedLayers;
