import { type ComponentPropsWithRef, type ReactNode } from "react";
import type { ShoppingCartItem as PortableShoppingCartItem } from "../../src/core/shopping-cart";
import type { ShoppingCartContract } from "../../src/core/contracts/shoppingcart";
export type ShoppingCartItem = PortableShoppingCartItem<ReactNode>;
export interface ShoppingCartProps extends ShoppingCartContract, Omit<ComponentPropsWithRef<"form">, keyof ShoppingCartContract | "children"> {
    /** Caller-owned cart data with native content. */
    items: readonly ShoppingCartItem[];
    /** Recovery content for an empty cart. */
    empty?: ReactNode;
    /** Controls after a non-empty cart's total. */
    actions?: ReactNode;
    /** Reports the typed quantity; NaN means the field was cleared. */
    onQuantityChange?: (id: string, quantity: number) => void;
    /** Reports a removal request; omitting it removes the affordance. */
    onRemove?: (id: string) => void;
    /** Additional form classes. */
    className?: string;
}
export declare function ShoppingCart({ title, level, items, totalLabel, total, empty, actions, className, itemClass, quantityClass, onQuantityChange, onRemove, ...rest }: ShoppingCartProps): import("react").JSX.Element;
