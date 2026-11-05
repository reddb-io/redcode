import type { ComponentPropsWithRef } from "react";
export interface AudioMeterProps extends Omit<ComponentPropsWithRef<"div">, "children"> {
    /** Linear input level from 0 to 1, supplied by the host. */
    value: number;
    /** Accessible name and visible label. */
    label?: string;
    /** Show the current level or signed time-domain samples. */
    mode?: "level" | "waveform";
    /** Oldest to newest signed samples in -1 to 1; timing belongs to the host. */
    samples?: readonly number[];
    /** Hide the visible summary for compact use. */
    compact?: boolean;
}
export declare function AudioMeter({ value, label, mode, samples, compact, className, ...rest }: AudioMeterProps): import("react").JSX.Element;
