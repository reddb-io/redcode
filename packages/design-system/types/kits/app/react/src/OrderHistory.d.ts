import { type ComponentPropsWithRef } from "react";
import type { OrderHistoryContract } from "../../src/core/contracts/orderhistory";
export interface OrderHistoryProps extends OrderHistoryContract, Omit<ComponentPropsWithRef<"section">, keyof OrderHistoryContract | "children"> {
    /** Additional section classes. */
    className?: string;
}
export declare function OrderHistory({ title, level, caption, orders, labels, className, ...rest }: OrderHistoryProps): import("react").JSX.Element;
