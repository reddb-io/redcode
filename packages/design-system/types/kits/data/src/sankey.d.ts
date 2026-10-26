import { type VisualizationItem } from "./visualization";
export interface SankeyNode extends VisualizationItem {
}
export interface SankeyLink extends VisualizationItem {
    source: string;
    target: string;
    value: number;
}
export interface SankeyData {
    nodes: readonly SankeyNode[];
    links: readonly SankeyLink[];
}
/** Validate before handing fresh copies to LayerChart's mutating layout engine. */
export declare function sankeyData(data: SankeyData): {
    nodes: SankeyNode[];
    links: {
        source: string;
        target: string;
        value: number;
        color?: import("./core/chart-color").ColorToken;
        id: string;
        label: string;
        description?: string;
        series?: import("./visualization").VisualizationSeries;
        href?: string;
    }[];
};
