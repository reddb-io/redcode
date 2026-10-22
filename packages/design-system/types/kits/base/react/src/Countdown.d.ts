import type { ComponentPropsWithRef } from "react";
export interface CountdownProps extends Omit<ComponentPropsWithRef<"div">, "children"> {
    /** Caller-controlled remaining time in seconds. */
    remaining: number;
    /**
     * Visible text naming what is counting down, shown beside the time. Defaults to `Time
     * remaining`.
     */
    label?: string;
    /** Text shown in place of the time once `remaining` reaches zero. Defaults to `Complete`. */
    completeLabel?: string;
    /**
     * Formats the remaining whole seconds for display. Defaults to a clock such as `1:05` or
     * `1:02:05`.
     */
    formatValue?: (remaining: number) => string;
    /** Extra classes merged onto the countdown root. */
    className?: string;
}
export declare function Countdown({ remaining, label, completeLabel, formatValue, className, ...rest }: CountdownProps): import("react").JSX.Element;
