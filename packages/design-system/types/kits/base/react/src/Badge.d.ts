import type { ComponentPropsWithRef, ReactNode } from "react";
import { type BadgeVariant } from "../../src/badge.variants";
import type { Tone } from "../../src/tone";
export interface BadgeProps extends ComponentPropsWithRef<"span"> {
    /** Required status text; colour alone never carries meaning. */
    children: ReactNode;
    /** Shared semantic meaning. */
    tone?: Tone;
    /** Status emphasis, tinted by default. */
    variant?: BadgeVariant;
}
export declare function Badge({ tone, variant, className, ...rest }: BadgeProps): import("react").JSX.Element;
