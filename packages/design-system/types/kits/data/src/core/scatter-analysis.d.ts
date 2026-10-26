import type { ScatterPoint } from "../scatter";
import { type ChartPalette } from "./chart-color";
/** Quantitative scale, independently chosen per axis. */
export type ScatterScale = "linear" | "log";
/** An application-owned highlighted measurement region. */
export interface ScatterRegion {
    /** Optional color custom-property name for the region fill. */
    color?: import("./chart-color").ColorToken;
    /** Unique region identity. */
    id: string;
    /** Human-readable region meaning. */
    label: string;
    /** Increasing horizontal region bounds in original units. */
    x: readonly [number, number];
    /** Increasing vertical region bounds in original units. */
    y: readonly [number, number];
}
/** Shared analytical overlays and scale semantics. */
export interface ScatterAnalysisOptions {
    /** Horizontal measurement scale; log requires positive values. Defaults to linear. */
    xScale?: ScatterScale;
    /** Vertical measurement scale; log requires positive values. Defaults to linear. */
    yScale?: ScatterScale;
    /** Directions defining the nondominated frontier; independent of regression. */
    pareto?: {
        x: "minimize" | "maximize";
        y: "minimize" | "maximize";
    };
    /** Show collision-managed point labels. Defaults to false on Scatter and true on Quadrant. */
    pointLabels?: boolean;
    /** Highlighted regions, clipped to the visible domains. */
    highlights?: readonly ScatterRegion[];
    /** Stable entity-id color token map. */
    palette?: ChartPalette;
    /** Positive stroke width for analytical lines; defaults to 1.5. */
    strokeWidth?: number;
}
export declare function scaleProject(value: number, range: readonly [number, number], start: number, end: number, scale?: ScatterScale): number;
export declare function scaleTicks(range: readonly [number, number], scale?: ScatterScale, count?: number): number[];
/** Nondominated observations; exact coordinate ties keep the first stable observation. */
export declare function paretoFrontier(data: readonly ScatterPoint[], directions: NonNullable<ScatterAnalysisOptions["pareto"]>): ScatterPoint[];
export declare function scatterAnalysis(data: readonly ScatterPoint[], options: ScatterAnalysisOptions, xDomain?: readonly [number, number], yDomain?: readonly [number, number], trend?: boolean): {
    points: {
        color: `--${string}` | undefined;
        x: number;
        y: number;
        radius?: number;
        id: string;
        label: string;
        description?: string;
        series?: import("../visualization").VisualizationSeries;
        href?: string;
    }[];
    xd: [number, number];
    yd: [number, number];
    frontier: ScatterPoint[];
    line: {
        x: number;
        y: number;
    }[] | undefined;
    highlights: {
        x: [number, number];
        y: [number, number];
        /** Optional color custom-property name for the region fill. */
        color?: import("./chart-color").ColorToken;
        /** Unique region identity. */
        id: string;
        /** Human-readable region meaning. */
        label: string;
    }[];
};
/** Deterministic label placement in the measured plot, shared by both native adapters. */
export declare function scatterDrawing(model: ReturnType<typeof scatterAnalysis>, options: ScatterAnalysisOptions, width: number, height: number, formatX: (n: number) => string, formatY: (n: number) => string): {
    left: number;
    right: number;
    top: number;
    bottom: number;
    points: {
        x: number;
        y: number;
        paint: string;
        caption: {
            x: number;
            y: number;
            anchor: "start" | "end";
            text: string;
        } | undefined;
        color: `--${string}` | undefined;
        radius?: number;
        id: string;
        label: string;
        description?: string;
        series?: import("../visualization").VisualizationSeries;
        href?: string;
    }[];
    path: (points: readonly {
        x: number;
        y: number;
    }[]) => string;
    xTicks: {
        value: number;
        position: number;
        label: string;
    }[];
    yTicks: {
        value: number;
        position: number;
        label: string;
    }[];
    regions: {
        x: number;
        y: number;
        width: number;
        height: number;
        /** Optional color custom-property name for the region fill. */
        color?: import("./chart-color").ColorToken;
        /** Unique region identity. */
        id: string;
        /** Human-readable region meaning. */
        label: string;
    }[];
};
