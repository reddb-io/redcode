import { type ComponentPropsWithRef, type ReactNode } from "react";
import type { ProductFeatureContract } from "../../src/core/contracts/productfeature";
export interface ProductFeatureProps extends ProductFeatureContract, Omit<ComponentPropsWithRef<"div">, keyof ProductFeatureContract | "children"> {
    /** Product imagery with its own alternative text. */
    media: ReactNode;
    /** Detail below the heading. */
    children?: ReactNode;
    /** Actions after the detail. */
    actions?: ReactNode;
    /** Additional root classes. */
    className?: string;
}
export declare function ProductFeature({ title, description, level, mediaSide, media, children, actions, className, ...rest }: ProductFeatureProps): import("react").JSX.Element;
