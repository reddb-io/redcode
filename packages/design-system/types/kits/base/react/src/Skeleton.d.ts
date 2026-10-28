import { type ComponentPropsWithRef } from "react";
import type { SkeletonContract } from "../../src/core/contracts/skeleton";
export interface SkeletonProps extends SkeletonContract, Omit<ComponentPropsWithRef<"div">, "children"> {
}
export declare function Skeleton({ shape, label, rows, columns, animated, style, className, ...rest }: SkeletonProps): import("react").JSX.Element;
