import type { CompositeChartSeries, CompositeReference } from "./core/composite-chart";
import type { VisualizationSeries } from "./visualization";
/** Observation or forecast point. Repeated times express vertical resets. */
export interface ProjectionPoint {
    x: number;
    y: number;
}
/** Labeled metric displayed above the chart. */
export interface ProjectionMetric {
    label: string;
    value: string;
}
/** A labeled event on the shared time axis. */
export interface ProjectionAnnotation {
    id: string;
    label: string;
    time: number;
}
/** Portable properties of a recorded and projected metric. */
export interface ProjectionChartContract {
    /** Visible and accessible name. */
    label: string;
    /** Prominent current value, formatted by the caller. */
    value: string;
    /** Context beside the current value. */
    context?: string;
    /** Supporting measurements. */
    metrics?: readonly ProjectionMetric[];
    /** Recorded points, in chronological order. */
    recorded: readonly ProjectionPoint[];
    /** Projected points, in chronological order. */
    projected: readonly ProjectionPoint[];
    /** Time at which the forecast starts. */
    now: number;
    /** Axis range, which must include zero because the recorded area is filled. */
    valueDomain: readonly [number, number];
    /** Additional events shown as labeled references. */
    annotations?: readonly ProjectionAnnotation[];
    /** Name of the time marker. */
    nowLabel?: string;
    /** Legend label of the recorded series. */
    recordedLabel?: string;
    /** Legend label of the projected series. */
    projectedLabel?: string;
    /** Semantic series role. */
    series?: VisualizationSeries;
    /** Axis and readout formatter for values. */
    formatValue?: (value: number) => string;
    /** Axis and readout formatter for time. */
    formatTime?: (value: number) => string;
}
export declare function projectionChartModel(props: ProjectionChartContract): {
    data: CompositeChartSeries[];
    references: CompositeReference[];
};
