import { type CompositeLayout, type CompositeModel, type ResolvedCompositePoint } from "./composite-chart";
export interface CompositeRect {
    x: number;
    y: number;
    width: number;
    height: number;
}
export interface CompositeCandle extends CompositeRect {
    key: number;
    center: number;
    high: number;
    low: number;
    direction: "up" | "down" | "flat";
}
/** Shared native geometry: the two renderers emit exactly the same marks. */
export declare function compositeGeometry(model: CompositeModel, layout: CompositeLayout, hiddenSeries: readonly string[]): {
    layers: {
        path: string;
        fill: string;
        rects: CompositeRect[];
        candles: CompositeCandle[];
        id: string;
        label: string;
        kind: import("./composite-chart").CompositeChartSeries["kind"];
        axis: "primary" | "secondary";
        paint: string;
        dash?: string;
        points: ResolvedCompositePoint[];
        samples: Map<number, ResolvedCompositePoint>;
    }[];
    references: {
        x1: number;
        x2: number;
        y1: number;
        y2: number;
        id: string;
        label: string;
        paint: string;
        kind: "value" | "sample";
        value: number;
        axis: "primary" | "secondary";
    }[];
    cursor: (key: number) => number;
};
