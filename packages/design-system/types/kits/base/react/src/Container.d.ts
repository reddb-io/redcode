import type { ComponentPropsWithRef } from "react";
import { type ContainerSize } from "../../src/container.variants";
export interface ContainerProps extends ComponentPropsWithRef<"div"> {
    /** DS width role, independent from Density-owned inline insets. */
    size?: ContainerSize;
}
export declare function Container({ size, className, ...rest }: ContainerProps): import("react").JSX.Element;
