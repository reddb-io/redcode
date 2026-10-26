import { type VisualizationItem, type VisualizationSeries } from "./visualization";
export interface ExplodedLayer extends VisualizationItem {
}
export declare function explodedLayers(data: readonly ExplodedLayer[]): {
    series: VisualizationSeries;
    color?: import("./core/chart-color").ColorToken;
    id: string;
    label: string;
    description?: string;
    href?: string;
}[];
/** Rounded isometric plates, fitted to the drawing rather than leaving an unused row. */
export declare function explodedLayout(data: readonly ExplodedLayer[], width: number, height: number, unit?: number): {
    index: number;
    cy: number;
    left: number;
    right: number;
    depth: number;
    thickness: number;
    top: string;
    leftFace: string;
    rightFace: string;
    front: string;
    labelX: number;
    labelWidth: number;
    color?: import("./core/chart-color").ColorToken;
    id: string;
    label: string;
    description?: string;
    series?: VisualizationSeries;
    href?: string;
}[];
/** Wrap callouts without squeezing type or discarding their descriptions. */
export declare function layerLines(text: string, columns: number): string[];
