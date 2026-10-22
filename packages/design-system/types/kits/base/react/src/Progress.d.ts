import type { ComponentPropsWithRef } from "react";
import type { Tone } from "../../src/tone";
export interface ProgressProps extends Omit<ComponentPropsWithRef<"div">, "children"> {
    /** Omit or use null for indeterminate work. */
    value?: number | null;
    /** Lower bound of the scale. */
    min?: number;
    /** Upper bound; invalid or collapsed ranges are normalized safely. */
    max?: number;
    /** Accessible name of the reading. */
    label?: string;
    /** Formats the clamped value for visible and audible reading. */
    formatValue?: (value: number) => string;
    /** Shared semantic meaning; neutral uses ink. */
    tone?: Tone;
    /** Show the accessible name and normalized reading above the track. */
    summary?: boolean;
    /** Decorative divisions, bounded to 128; exact readings are preserved. */
    segments?: number;
    /** Maximum segments per row; omitted, keeps one row. */
    segmentColumns?: number;
}
export declare function Progress({ value, min, max, label, summary, formatValue, tone, segments, segmentColumns, className, ...rest }: ProgressProps): import("react").JSX.Element;
