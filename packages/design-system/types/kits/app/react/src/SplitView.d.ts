import { type ComponentPropsWithRef, type ReactNode } from "react";
import type { SplitViewContract } from "../../src/core/contracts/splitview";
export interface SplitViewProps extends SplitViewContract, Omit<ComponentPropsWithRef<"div">, keyof SplitViewContract | "children"> {
    /** Reports a fraction after a pointer or keyboard move. */
    onFractionChange?: (fraction: number) => void;
    /** Leading pane content. */
    start?: ReactNode;
    /** Trailing pane content. */
    end?: ReactNode;
    /** Additional root classes. */
    className?: string;
}
export declare function SplitView(props: SplitViewProps): import("react").JSX.Element;
