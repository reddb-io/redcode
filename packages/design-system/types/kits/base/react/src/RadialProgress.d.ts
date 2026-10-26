import { type RadialReading } from "../../src/core/radial";
import { type ColorToken } from "../../src/core/color-token";
import type { ReactNode, ComponentPropsWithRef } from "react";
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
    /** Ring width as a fraction of outer radius, strictly between zero and one. */
    thickness?: number;
    /** Color custom-property name; omitted, uses tone. */
    color?: ColorToken;
    /** Explicit diameter in pixels; omitted, follows size and Density. */
    diameter?: number;
    /** Noninteractive content replacing the default centered percentage. */
    center?: (reading: RadialReading) => ReactNode;
    /** Density-responsive ring diameter. */
    size?: RadialProgressSize;
}
export declare function RadialProgress({ value, min, max, label, size, formatValue, tone, thickness, color, diameter, center, style, className, ...rest }: RadialProgressProps): import("react").JSX.Element;
