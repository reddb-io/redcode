import type { ComponentPropsWithRef, ReactNode } from "react";
import type { ProductQuickviewContract } from "../../src/core/contracts/productquickview";
export interface ProductQuickviewProps extends ProductQuickviewContract, Omit<ComponentPropsWithRef<"div">, keyof ProductQuickviewContract | "children"> {
    /** Custom content inside the named trigger Button. */
    trigger?: ReactNode;
    /** Product imagery with its own alternative text. */
    media?: ReactNode;
    /** Product details and controls. */
    children?: ReactNode;
    /** Dialog actions receiving its close operation. */
    actions?: (context: {
        close: () => void;
    }) => ReactNode;
    /** Additional wrapper classes. */
    className?: string;
}
export declare function ProductQuickview({ triggerLabel, title, description, trigger, media, children, actions, className, dialogClass, ...rest }: ProductQuickviewProps): import("react").JSX.Element;
