import { type ComponentPropsWithRef, type ReactNode } from "react";
import type { TooltipContract } from "../../src/core/contracts/tooltip";
export interface TooltipProps extends TooltipContract, Omit<ComponentPropsWithRef<"button">, keyof TooltipContract | "aria-describedby" | "aria-label" | "type" | "children"> {
    /** Content of the default named trigger. */
    children?: ReactNode;
    /** Render one focusable native trigger and spread its props. */
    child?: (context: {
        props: Record<string, unknown>;
    }) => ReactNode;
    /** Extra trigger classes. */
    className?: string;
}
export declare function Tooltip({ label, content, children, child, className, disabled, ...rest }: TooltipProps): import("react").JSX.Element;
