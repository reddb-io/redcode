import { type ReactNode } from "react";
import type { NavbarContract } from "../../src/core/contracts/navbar";
export interface NavbarProps extends NavbarContract {
    /** Leading identity slot in both arrangements. */
    brand?: ReactNode;
    /** Trailing controls in the rail and compact panel. */
    actions?: ReactNode;
    /** Reports changes to the compact panel's open state. */
    onOpenChange?: (open: boolean) => void;
    /** Additional landmark classes. */
    className?: string;
}
export declare function Navbar(props: NavbarProps): import("react").JSX.Element;
