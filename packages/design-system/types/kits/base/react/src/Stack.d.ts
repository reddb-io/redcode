import type { ComponentPropsWithRef } from "react";
import { type StackGap, type StackDirection, type StackAlign, type StackJustify } from "../../src/stack.variants";
export interface StackProps extends ComponentPropsWithRef<"div"> {
    /** Density-owned child spacing; layout-md by default. */
    gap?: StackGap;
    /** Main axis, column by default. */
    direction?: StackDirection;
    /** Cross-axis alignment. */
    align?: StackAlign;
    /** Main-axis distribution. */
    justify?: StackJustify;
    /** Allow wrapping when space runs out. */
    wrap?: boolean;
}
export declare function Stack({ gap, direction, align, justify, wrap, className, ...rest }: StackProps): import("react").JSX.Element;
