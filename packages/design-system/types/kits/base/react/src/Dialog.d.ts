import { type ComponentPropsWithRef, type ReactNode } from "react";
import type { DialogContract } from "../../src/core/contracts/dialog";
export interface DialogProps extends DialogContract, Omit<ComponentPropsWithRef<"dialog">, keyof DialogContract | "children" | "aria-labelledby" | "aria-describedby"> {
    /** Replaces the visible title and standard close control; receives the canonical close operation. */
    header?: (actions: {
        close: () => void;
    }) => ReactNode;
    /** Custom trigger content named by triggerLabel. */
    trigger?: ReactNode;
    /** Dialog body. */
    children?: ReactNode;
    /** Optional action region with the canonical close operation. */
    actions?: (actions: {
        close: () => void;
    }) => ReactNode;
    /** Called whenever the Dialog requests an open-state change. */
    onOpenChange?: (open: boolean) => void;
    /** Additional surface classes. */
    className?: string;
}
export declare function Dialog(props: DialogProps): import("react").JSX.Element;
