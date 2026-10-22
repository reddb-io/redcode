import { type VariantProps } from "tailwind-variants";
/** Caller-owned order facts rendered with native table relationships. */
export interface OrderHistoryEntry {
    id: string;
    placed: string;
    placedAt: string;
    status: string;
    total: string;
}
/** Visible caller-owned column vocabulary for an order history. */
export interface OrderHistoryLabels {
    order: string;
    placed: string;
    status: string;
    total: string;
}
export declare const DEFAULT_ORDER_HISTORY_LABELS: OrderHistoryLabels;
/**
 * Token-only arrangement around canonical Base heading and table contracts.
 * A group's heading sits `layout-gap-sm` above its content (ADR 0024).
 */
export declare const orderHistory: import("tailwind-variants").TVReturnType<{
    [key: string]: {
        [key: string]: import("tailwind-variants").ClassValue | {
            heading?: import("tailwind-variants").ClassValue;
            root?: import("tailwind-variants").ClassValue;
        };
    };
} | {
    [x: string]: {
        [x: string]: import("tailwind-variants").ClassValue | {
            heading?: import("tailwind-variants").ClassValue;
            root?: import("tailwind-variants").ClassValue;
        };
    };
} | {}, {
    root: string;
    heading: string;
}, undefined, {
    [key: string]: {
        [key: string]: import("tailwind-variants").ClassValue | {
            heading?: import("tailwind-variants").ClassValue;
            root?: import("tailwind-variants").ClassValue;
        };
    };
} | {}, {
    root: string;
    heading: string;
}, import("tailwind-variants").TVReturnType<unknown, {
    root: string;
    heading: string;
}, undefined, unknown, unknown, undefined>>;
export type OrderHistoryVariants = VariantProps<typeof orderHistory>;
