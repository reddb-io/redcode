import type { ComponentPropsWithRef, ReactNode } from "react";
import { type IndicatorPosition } from "../../src/indicator.variants";
export interface IndicatorProps extends ComponentPropsWithRef<"span"> {
    /** Caller-owned marker placed around the anchored child. */
    marker: ReactNode;
    /** Content whose box establishes the placement boundary. */
    children: ReactNode;
    /** Logical marker anchor. */
    position?: IndicatorPosition;
}
export declare function Indicator({ marker, children, position, className, ...rest }: IndicatorProps): import("react").JSX.Element;
