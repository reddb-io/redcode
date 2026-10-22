import type { ComponentPropsWithRef } from "react";
import { type SkeletonShape } from "../../src/skeleton.variants";
export interface SkeletonProps extends Omit<ComponentPropsWithRef<"div">, "children"> {
    /** Placeholder geometry: text, rectangle or circle. */
    shape?: SkeletonShape;
    /** Optional announcement when this placeholder owns the loading state. */
    label?: string;
}
export declare function Skeleton({ shape, label, className, ...rest }: SkeletonProps): import("react").JSX.Element;
