import type { ComponentPropsWithRef } from "react";
export interface AspectRatioProps extends ComponentPropsWithRef<"div"> {
    /** Width divided by height; any positive ratio is supported. */
    ratio?: number;
}
export declare function AspectRatio({ ratio, style, className, ...rest }: AspectRatioProps): import("react").JSX.Element;
