import { type ComponentPropsWithRef, type ReactNode } from "react";
import type { ProductListItem as PortableProductListItem } from "../../src/core/product-list";
import type { ProductListContract } from "../../src/core/contracts/productlist";
export type ProductListItem = PortableProductListItem<ReactNode>;
export interface ProductListProps extends ProductListContract, Omit<ComponentPropsWithRef<"ul">, keyof ProductListContract | "children"> {
    /** Caller-owned entries with native media and action content. */
    items: readonly ProductListItem[];
    /** Replaces the canonical empty content. */
    empty?: ReactNode;
    /** Additional list classes. */
    className?: string;
}
export declare function ProductList({ label, items, columns, empty, headingLevel, className, ...rest }: ProductListProps): import("react").JSX.Element;
