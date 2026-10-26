import type { ChartTimeRange } from "../chart";
import { type ChartNumberFormat, type ChartSeries } from "../chart";
/** A shared observation coordinate. String categories cannot be mixed with numbers or Dates. */
export type CompositeX = number | Date | string;
/** One value; null is an explicit gap and is never interpolated over. */
export interface CompositePoint {
    /** Shared time, numeric coordinate or category. */
    x: CompositeX;
    /** Observed value, or null when unavailable. */
    y: number | null;
}
/** An OHLC observation; invalid bounds are omitted rather than repaired. */
export interface CandlePoint {
    /** Shared time, numeric coordinate or category. */
    x: CompositeX;
    /** Opening value, inside low and high. */
    open: number;
    /** Highest value, at least open and close. */
    high: number;
    /** Lowest value, at most open and close. */
    low: number;
    /** Closing value, inside low and high. */
    close: number;
}
interface CompositeSeriesIdentity {
    /** Unique stable identity used by legend state. */
    id: string;
    /** Visible series name. */
    label: string;
    /** Primary scale by default; secondary requires a named secondaryAxis. */
    axis?: "primary" | "secondary";
    /** DS categorical Series Role, assigned cyclically when omitted. */
    series?: ChartSeries;
    /** Ascending drawing order; array order breaks ties. */
    order?: number;
}
/** A line, area or column layer. Columns become horizontal bars when orientation is horizontal. */
export interface CompositeValueSeries extends CompositeSeriesIdentity {
    /** Geometry of this layer, independent of every other series. */
    kind: "line" | "area" | "column";
    /** Caller-owned observations; last duplicate coordinate wins. */
    data: readonly CompositePoint[];
    /** Straight segments by default; dash distinguishes trend or target lines. */
    dash?: "solid" | "dashed" | "dotted";
}
/** A candle layer; hollow rising, filled falling and a cross for unchanged values. */
export interface CompositeCandleSeries extends CompositeSeriesIdentity {
    /** Candle geometry with OHLC bounds. */
    kind: "candlestick";
    /** Caller-owned OHLC observations; last duplicate coordinate wins. */
    data: readonly CandlePoint[];
}
/** One layer in a composed chart. */
export type CompositeChartSeries = CompositeValueSeries | CompositeCandleSeries;
/** A value scale; primary and secondary units are independent. */
export interface CompositeAxis {
    /** Visible unit/scale name, paired with its side in the legend bar. */
    label: string;
    /** Formatter shared by ticks and inspection. */
    format?: ChartNumberFormat;
    /** Exact finite increasing bounds. Omitted, inferred from all layers on this scale. */
    domain?: readonly [number, number];
}
interface ReferenceIdentity {
    /** Unique reference identity. */
    id: string;
    /** Visible text in the reference's accessible description and native tooltip. */
    label: string;
    /** DS Series Role; defaults to six. */
    series?: ChartSeries;
}
/** A reference level or observation marker. Its direction follows the chosen orientation. */
export type CompositeReference = ReferenceIdentity & ({
    kind: "value"; /** Level on the selected value scale. */
    value: number; /** Primary scale unless specified. */
    axis?: "primary" | "secondary";
} | {
    kind: "sample"; /** Observation coordinate to mark. */
    x: CompositeX;
});
export interface ResolvedCompositePoint {
    x: number;
    value: number | null;
    candle?: CandlePoint;
}
export interface ResolvedCompositeSeries {
    id: string;
    label: string;
    kind: CompositeChartSeries["kind"];
    axis: "primary" | "secondary";
    paint: string;
    dash?: string;
    points: ResolvedCompositePoint[];
    samples: Map<number, ResolvedCompositePoint>;
}
export interface CompositeSample {
    key: number;
    value: CompositeX;
}
export interface CompositeModel {
    series: ResolvedCompositeSeries[];
    samples: CompositeSample[];
    sampleDomain: [number, number];
    primaryDomain: [number, number];
    secondaryDomain: [number, number];
    categorical: boolean;
    interval: number;
    references: {
        id: string;
        label: string;
        paint: string;
        kind: "value" | "sample";
        value: number;
        axis: "primary" | "secondary";
    }[];
}
export declare const compositePaint: (series?: ChartSeries) => string;
export declare const compositeDash: (dash?: "solid" | "dashed" | "dotted") => "6 3" | "2 3" | undefined;
/** Validate identities/scales and normalize coordinates once, without changing caller data. */
export declare function resolveCompositeChart(data: readonly CompositeChartSeries[], orientation?: "vertical" | "horizontal", primaryAxis?: CompositeAxis, secondaryAxis?: CompositeAxis, references?: readonly CompositeReference[], timeRange?: ChartTimeRange): CompositeModel;
/** Exact, timezone-independent default sample description. */
export declare function formatCompositeSample(value: CompositeX): string;
/** Compact default tick labels; exact values remain in the shared readout. */
export declare function formatCompositeTick(value: CompositeX): string;
/** Nearest actual observation, using binary search rather than interpolating missing values. */
export declare function compositeNearest(samples: readonly CompositeSample[], value: number): number;
/** Keyboard sample selection, shared across native adapters. */
export declare function compositeKey(key: string, index: number, count: number): number | undefined;
/** Exact reading. Candle OHLC fields never collapse to just their closing value. */
export declare function compositeReading(series: ResolvedCompositeSeries, key: number | undefined, format?: ChartNumberFormat): string;
/** One shared inspection/empty-state model for inline and maximized native adapters. */
export declare function compositeInspection(model: CompositeModel, hiddenSeries: readonly string[], active: number | undefined, primaryAxis?: CompositeAxis, secondaryAxis?: CompositeAxis, formatX?: typeof formatCompositeSample, hasLegend?: boolean): {
    index: number;
    sample: CompositeSample;
    sampleLabel: string;
    readings: {
        id: string;
        label: string;
        value: string;
    }[];
    announcement: string;
    empty: string | undefined;
};
export interface CompositeTick {
    value: number;
    label: string;
    position: number;
}
export interface CompositeLayout {
    width: number;
    height: number;
    padding: {
        top: number;
        right: number;
        bottom: number;
        left: number;
    };
    plotWidth: number;
    plotHeight: number;
    sampleTicks: CompositeTick[];
    primaryTicks: CompositeTick[];
    secondaryTicks: CompositeTick[];
    horizontal: boolean;
}
export declare const compositeProject: (value: number, domain: readonly [number, number], length: number) => number;
/** Shared content-aware gutters and collision-free labels for native chart renderers. */
export declare function compositeLayout(model: CompositeModel, width: number, height: number, horizontal?: boolean, presentation?: "full" | "minimal", primaryAxis?: CompositeAxis, secondaryAxis?: CompositeAxis, formatX?: typeof formatCompositeTick): CompositeLayout;
export {};
