import type { ComponentPropsWithRef, ReactNode } from "react";
import type { MultiColumnLayoutContract } from "../../src/core/contracts/multicolumnlayout";
export interface MultiColumnLayoutProps extends MultiColumnLayoutContract, Omit<ComponentPropsWithRef<"div">, keyof MultiColumnLayoutContract | "children"> {
    /** Leading column. */
    start?: ReactNode;
    /** Primary column. */
    children?: ReactNode;
    /** Trailing column; its presence selects three columns. */
    end?: ReactNode;
    /** Additional container classes. */
    className?: string;
}
export declare function MultiColumnLayout({ start, children, end, gap, className, ...rest }: MultiColumnLayoutProps): import("react").JSX.Element;
