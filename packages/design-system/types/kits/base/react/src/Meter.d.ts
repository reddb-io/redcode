import type { ComponentPropsWithRef } from "react";
import { type MeterTone } from "../../src/meter.variants";
export interface MeterProps extends Omit<ComponentPropsWithRef<"div">, "children"> {
    /** Measured value, clamped into the normalized range. */
    value: number;
    /** Lower bound of the scale. */
    min?: number;
    /** Upper bound; invalid or collapsed ranges are normalized safely. */
    max?: number;
    /** Accessible name of the reading. */
    label?: string;
    /** Formats the clamped value for visible and audible reading. */
    formatValue?: (value: number) => string;
    /** Shared semantic meaning; neutral uses ink. */
    tone?: MeterTone;
    /** Track beside the reading or below its summary. */
    layout?: "stacked" | "inline";
    /** Hide the visible label while retaining the accessible name. */
    labelHidden?: boolean;
    /** Decorative divisions, bounded to 128; exact readings are preserved. */
    segments?: number;
    /** Maximum segments per row; omitted, keeps one row. */
    segmentColumns?: number;
}
export declare function Meter({ value, min, max, label, layout, labelHidden, formatValue, tone, segments, segmentColumns, className, ...rest }: MeterProps): import("react").JSX.Element;
