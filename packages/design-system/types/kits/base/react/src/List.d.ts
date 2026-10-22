import type { ComponentPropsWithRef } from "react";
import { type ListGap } from "../../src/list.variants";
interface ListAppearance {
    /** Render an ordered list rather than an unordered one. */
    ordered?: boolean;
    /** Density-owned space between items. */
    gap?: ListGap;
}
export type ListProps = ListAppearance & ((Omit<ComponentPropsWithRef<"ul">, keyof ListAppearance> & {
    ordered?: false;
}) | (Omit<ComponentPropsWithRef<"ol">, keyof ListAppearance> & {
    ordered: true;
}));
export declare function List({ ordered, gap, className, ...rest }: ListProps): import("react").JSX.Element;
export {};
