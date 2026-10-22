import type { ComponentPropsWithRef } from "react";
import { type RadialProgressSize } from "../../src/radial-progress.variants";
import type { Tone } from "../../src/tone";
export interface RadialProgressProps extends Omit<ComponentPropsWithRef<"div">, "children"> {
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
    /** Density-responsive ring diameter. */
    size?: RadialProgressSize;
}
export declare function RadialProgress({ value, min, max, label, size, formatValue, tone, className, ...rest }: RadialProgressProps): import("react").JSX.Element;
