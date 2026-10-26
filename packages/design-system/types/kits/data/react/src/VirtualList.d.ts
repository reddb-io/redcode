import { type ReactNode } from "react";
import type { VirtualListContract } from "../../src/core/contracts/virtuallist";
export interface VirtualListProps<T> extends VirtualListContract<T> {
    /** Content for one fixed-height row, retaining its native item and index types. */
    children: (item: T, index: number) => ReactNode;
    /** Additional scroll-region classes. */
    className?: string;
}
export declare function VirtualList<T>({ label, items, rowKey, rowUnits, visibleRows, overscan, children, emptyLabel, className, }: VirtualListProps<T>): import("react").JSX.Element;
export default VirtualList;
