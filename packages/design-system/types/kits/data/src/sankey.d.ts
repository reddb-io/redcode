import { type VisualizationItem, type VisualizationSeries } from "./visualization";
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
    nodes: {
        series: VisualizationSeries;
        id: string;
        label: string;
        description?: string;
        href?: string;
    }[];
    links: {
        source: string;
        target: string;
        value: number;
        id: string;
        label: string;
        description?: string;
        series?: VisualizationSeries;
        href?: string;
    }[];
};
