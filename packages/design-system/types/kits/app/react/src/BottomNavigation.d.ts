import type { ComponentPropsWithRef } from "react";
import type { BottomNavigationContract } from "../../src/core/contracts/bottomnavigation";
export interface BottomNavigationProps extends BottomNavigationContract, Omit<ComponentPropsWithRef<"nav">, keyof BottomNavigationContract | "children"> {
    /** Additional navigation classes. */
    className?: string;
}
export declare function BottomNavigation({ label, items, currentId, className, ...rest }: BottomNavigationProps): import("react").JSX.Element;
