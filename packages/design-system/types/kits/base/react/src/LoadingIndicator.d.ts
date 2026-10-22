import type { ComponentPropsWithRef } from "react";
import { type LoadingIndicatorSize } from "../../src/loading-indicator.variants";
export interface LoadingIndicatorProps extends ComponentPropsWithRef<"div"> {
    /** What is being waited for. */
    label?: string;
    /** Density-responsive glyph size. */
    size?: LoadingIndicatorSize;
    /** Hide the sentence visually while retaining its announcement. */
    labelHidden?: boolean;
}
export declare function LoadingIndicator({ label, size, labelHidden, className, ...rest }: LoadingIndicatorProps): import("react").JSX.Element;
