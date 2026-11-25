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
/**
 * The data explorer's rows: every flow, then every stage the chart draws with
 * its throughput (the larger of what enters and what leaves it). A selectable
 * stage is a mark too, so it needs a row to stay reachable from a control that
 * meets the touch floor.
 */
export declare function sankeyRows(data: SankeyData, format: (value: number) => string): {
    id: string;
    label: string;
    value: string;
}[];
