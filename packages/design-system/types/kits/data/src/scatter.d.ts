import { type VisualizationItem } from "./visualization";
export interface ScatterPoint extends VisualizationItem {
    x: number;
    y: number;
    radius?: number;
}
export declare function scatterData(data: readonly ScatterPoint[]): readonly ScatterPoint[];
/** Least-squares trend, absent for fewer than two distinct x values. */
export declare function regression(data: readonly ScatterPoint[]): {
    x: number;
    y: number;
}[] | undefined;
