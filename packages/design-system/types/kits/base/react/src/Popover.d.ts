import { type ReactNode } from "react";
import type { PopoverContract } from "../../src/core/contracts/popover";
export interface PopoverProps extends PopoverContract {
    /** Custom trigger content named by triggerLabel. */
    trigger?: ReactNode;
    /** Caller-owned Popover content. */
    children?: ReactNode;
    /** Extra classes on the anchored surface. */
    className?: string;
    /** Called when the Popover requests an open-state change. */
    onOpenChange?: (open: boolean) => void;
}
export declare function Popover(props: PopoverProps): import("react").JSX.Element;
