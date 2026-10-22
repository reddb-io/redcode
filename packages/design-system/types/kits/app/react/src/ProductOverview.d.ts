import { type ComponentPropsWithRef, type ReactNode } from "react";
import type { ProductOverviewContract } from "../../src/core/contracts/productoverview";
export interface ProductOverviewProps extends ProductOverviewContract, Omit<ComponentPropsWithRef<"section">, keyof ProductOverviewContract | "children"> {
    /** Product imagery, taking precedence over image. */
    media?: ReactNode;
    /** Product details or options. */
    children?: ReactNode;
    /** Canonical purchase controls. */
    actions?: ReactNode;
    /** Additional section classes. */
    className?: string;
}
export declare function ProductOverview({ title, description, price, level, media, image, priority, children, actions, className, ...rest }: ProductOverviewProps): import("react").JSX.Element;
