import type { ComponentPropsWithRef } from "react";
import { type LoadingIndicatorSize } from "../../src/loading-indicator.variants";
export interface LoadingIndicatorProps extends ComponentPropsWithRef<"div"> {
    /** What is being waited for. */
    label?: string;
    /** Spinner and label size: `sm`, `md` (the default) or `lg`. Beside its label the spinner follows the label's type role; with the label hidden it keeps the Density Icon size (ADR 0054). */
    size?: LoadingIndicatorSize;
    /** Hide the sentence visually while retaining its announcement. */
    labelHidden?: boolean;
}
export declare function LoadingIndicator({ label, size, labelHidden, className, ...rest }: LoadingIndicatorProps): import("react").JSX.Element;
