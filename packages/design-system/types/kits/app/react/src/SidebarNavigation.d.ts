import type { ComponentPropsWithRef, ReactNode } from "react";
import type { SidebarNavigationContract } from "../../src/core/contracts/sidebarnavigation";
export interface SidebarNavigationProps extends SidebarNavigationContract, Omit<ComponentPropsWithRef<"nav">, keyof SidebarNavigationContract | "children"> {
    /** Contextual actions above the destinations, in native tab order. */
    toolbar?: ReactNode;
    /** Additional navigation classes. */
    className?: string;
}
export declare function SidebarNavigation({ label, items, currentId, toolbar, toolbarLabel, className, ...rest }: SidebarNavigationProps): import("react").JSX.Element;
