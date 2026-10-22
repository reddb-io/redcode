import type { ComponentPropsWithRef } from "react";
import type { Tone } from "../../src/tone";
export interface StatusIndicatorProps extends ComponentPropsWithRef<"span"> {
    /** Status text that carries meaning independently of color. */
    label: string;
    /** Shared semantic meaning; neutral when omitted. */
    tone?: Tone;
    /** Show the label beside the mark; otherwise retain it as screen-reader text. */
    showLabel?: boolean;
}
export declare function StatusIndicator({ label, tone, showLabel, className, ...rest }: StatusIndicatorProps): import("react").JSX.Element;
