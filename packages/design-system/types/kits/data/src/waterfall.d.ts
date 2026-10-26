import { type VisualizationItem } from "./visualization";
export interface WaterfallStep extends VisualizationItem {
    value?: number;
    kind?: "delta" | "total" | "subtotal";
}
/** Totals set the running balance; subtotals observe it; deltas change it. */
export declare function waterfallSteps(data: readonly WaterfallStep[]): ({
    start: number;
    end: number;
    amount: number;
    kind: "subtotal";
    value?: number;
    color?: import("./core/chart-color").ColorToken;
    id: string;
    label: string;
    description?: string;
    series?: import("./visualization").VisualizationSeries;
    href?: string;
} | {
    start: number;
    end: number;
    amount: number;
    kind: "total";
    value?: number;
    color?: import("./core/chart-color").ColorToken;
    id: string;
    label: string;
    description?: string;
    series?: import("./visualization").VisualizationSeries;
    href?: string;
} | {
    start: number;
    end: number;
    amount: number;
    kind: "delta";
    value?: number;
    color?: import("./core/chart-color").ColorToken;
    id: string;
    label: string;
    description?: string;
    series?: import("./visualization").VisualizationSeries;
    href?: string;
})[];
