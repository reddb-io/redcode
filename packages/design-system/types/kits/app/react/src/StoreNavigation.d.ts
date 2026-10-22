import type { ComponentPropsWithRef, ReactNode } from "react";
import type { StoreNavigationContract } from "../../src/core/contracts/storenavigation";
export interface StoreNavigationProps extends StoreNavigationContract, Omit<ComponentPropsWithRef<"div">, keyof StoreNavigationContract | "children"> {
    /** Banner above the navbar. */
    announcement?: ReactNode;
    /** Identity at the start of the bar. */
    brand?: ReactNode;
    /** Trailing controls. */
    actions?: ReactNode;
    /** Additional root classes. */
    className?: string;
}
export declare function StoreNavigation({ label, items, currentId, collapse, announcement, brand, actions, className, ...rest }: StoreNavigationProps): import("react").JSX.Element;
