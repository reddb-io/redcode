import type { VisualizationSeries } from "./visualization";
/** Solid boxes in a projected scene; physical simulation remains caller-owned. */
export interface IsometricItem {
    id: string;
    label: string;
    x: number;
    y: number;
    z?: number;
    width?: number;
    depth?: number;
    height?: number;
    series?: VisualizationSeries;
    layer?: string;
}
export interface Point {
    x: number;
    y: number;
}
export declare function isoPoint(x: number, y: number, z: number): Point;
export declare function solidBox(width: number, depth: number, height: number, x?: number, y?: number, z?: number): {
    top: string;
    left: string;
    right: string;
    points: Point[];
    center: Point;
};
export declare function sceneGeometry(items: readonly IsometricItem[]): {
    boxes: {
        top: string;
        left: string;
        right: string;
        points: Point[];
        center: Point;
        id: string;
        label: string;
        x: number;
        y: number;
        z?: number;
        width?: number;
        depth?: number;
        height?: number;
        series?: VisualizationSeries;
        layer?: string;
    }[];
    viewBox: string;
    width: number;
    height: number;
};
export declare function stackItems(count: number, maxVisible: number): {
    shown: number;
    items: {
        id: string;
        label: string;
        x: number;
        y: number;
        z: number;
        width: number;
        depth: number;
        height: number;
    }[];
};
/** Geometry, visible layers and camera target are shared by both native adapters. */
export declare function isometricView(items: readonly IsometricItem[], layer: string | null, focused: string | null): {
    scene: {
        boxes: {
            top: string;
            left: string;
            right: string;
            points: Point[];
            center: Point;
            id: string;
            label: string;
            x: number;
            y: number;
            z?: number;
            width?: number;
            depth?: number;
            height?: number;
            series?: VisualizationSeries;
            layer?: string;
        }[];
        viewBox: string;
        width: number;
        height: number;
    };
    focus: {
        x: number;
        y: number;
        width: number;
        height: number;
    } | null;
};
