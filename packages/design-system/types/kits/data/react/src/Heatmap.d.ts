export * from "../../src/core/heatmap";
import type { HeatmapContract } from "../../src/core/contracts/heatmap";
export interface HeatmapProps extends HeatmapContract {
    /** Extra classes, merged onto the chart's root `figure`. */
    className?: string;
}
export declare function Heatmap(props: HeatmapProps): import("react").JSX.Element;
export default Heatmap;
