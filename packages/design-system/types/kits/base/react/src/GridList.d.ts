import type { ComponentPropsWithRef } from "react";
import { type GridListColumn } from "../../src/grid-list.variants";
import { type ListGap } from "../../src/list.variants";
interface GridListAppearance {
    /** Maximum columns, reduced intrinsically as the container narrows. */
    columns?: GridListColumn;
    /** Density-owned space between items. */
    gap?: ListGap;
    /** True for a list of li elements; false for a layout grid of blocks. */
    list?: boolean;
}
export type GridListProps = GridListAppearance & ((Omit<ComponentPropsWithRef<"ul">, keyof GridListAppearance> & {
    list?: true;
}) | (Omit<ComponentPropsWithRef<"div">, keyof GridListAppearance> & {
    list: false;
}));
export declare function GridList({ columns, gap, list, className, ...rest }: GridListProps): import("react").JSX.Element;
export {};
