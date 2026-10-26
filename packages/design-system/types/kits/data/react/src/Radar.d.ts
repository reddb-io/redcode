export type { VisualizationSize, VisualizationSeries, } from "../../src/visualization";
export type { RadarAxis, RadarSeries } from "../../src/radar";
import type { RadarContract } from "../../src/core/contracts/radar";
export interface RadarProps extends RadarContract {
    /** Reports selection for application-owned filtering or detail navigation. */
    onSelectedChange?: (id: string) => void;
    /** Extra classes on the outer figure. */
    className?: string;
}
export declare function Radar(props: RadarProps): import("react").JSX.Element;
export default Radar;
