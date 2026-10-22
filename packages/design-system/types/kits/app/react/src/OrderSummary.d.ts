import { type ComponentPropsWithRef, type ReactNode } from "react";
import type { OrderSummaryContract } from "../../src/core/contracts/ordersummary";
export interface OrderSummaryProps extends OrderSummaryContract, Omit<ComponentPropsWithRef<"div">, keyof OrderSummaryContract | "children"> {
    /** Optional checkout controls in the footer. */
    actions?: ReactNode;
    /** Additional Card classes. */
    className?: string;
}
export declare function OrderSummary({ title, level, lines, totalLabel, total, actions, className, ...rest }: OrderSummaryProps): import("react").JSX.Element;
