import type { VisualizationSeries } from "./visualization";
/** One compact event within a row. Times share the timeline's unit. */
export interface ActivityTimelineEvent {
    /** Stable id, unique in its row. */
    id: string;
    /** Human-readable name exposed in the event list. */
    label: string;
    /** Start of the interval. */
    start: number;
    /** End of the interval; equality renders an instant. */
    end: number;
    /** Separate lane for overlapping categories. */
    lane?: number;
    /** Theme-aware series color. */
    series?: VisualizationSeries;
}
/** A parent activity with summary metadata and multiple events. */
export interface ActivityTimelineRow {
    /** Stable unique row identity. */
    id: string;
    /** Primary activity name. */
    label: string;
    /** Supporting identity, such as a model or executor. */
    context?: string;
    /** Secondary measurements displayed beneath the title. */
    summary?: string;
    /** Right-aligned primary measurement, such as cost. */
    value?: string;
    /** Right-aligned time or status description. */
    detail?: string;
    /** Nested activity intervals. */
    events: readonly ActivityTimelineEvent[];
}
/** Normalized, clipped geometry shared by both native renderers. */
export declare function activityTimelineModel(rows: readonly ActivityTimelineRow[], domain?: readonly [number, number]): {
    domain: readonly [number, number];
    rows: {
        events: {
            left: number;
            width: number;
            lane: number;
            /** Stable id, unique in its row. */
            id: string;
            /** Human-readable name exposed in the event list. */
            label: string;
            /** Start of the interval. */
            start: number;
            /** End of the interval; equality renders an instant. */
            end: number;
            /** Theme-aware series color. */
            series?: VisualizationSeries;
        }[];
        /** Stable unique row identity. */
        id: string;
        /** Primary activity name. */
        label: string;
        /** Supporting identity, such as a model or executor. */
        context?: string;
        /** Secondary measurements displayed beneath the title. */
        summary?: string;
        /** Right-aligned primary measurement, such as cost. */
        value?: string;
        /** Right-aligned time or status description. */
        detail?: string;
    }[];
};
