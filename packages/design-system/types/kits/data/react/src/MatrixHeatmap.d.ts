export type { VisualizationSize, VisualizationSeries, } from "../../src/visualization";
export type { MatrixAxis, MatrixCell } from "../../src/matrix-heatmap";
import type { MatrixHeatmapContract } from "../../src/core/contracts/matrixheatmap";
export interface MatrixHeatmapProps extends MatrixHeatmapContract {
    /** Reports selection for application-owned filtering or detail navigation. */
    onSelectedChange?: (id: string) => void;
    /** Extra classes on the outer figure. */
    className?: string;
}
export declare function MatrixHeatmap(props: MatrixHeatmapProps): import("react").JSX.Element;
export default MatrixHeatmap;
