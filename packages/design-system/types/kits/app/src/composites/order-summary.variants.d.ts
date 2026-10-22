import { type VariantProps } from "tailwind-variants";
/** One caller-owned amount or fact in an order summary. */
export interface OrderSummaryLine {
    label: string;
    value: string;
}
/**
 * Token-only arrangement around canonical Base Card and DescriptionList. The
 * lines and the total are two blocks, `layout-gap-sm` apart (ADR 0024).
 */
export declare const orderSummary: import("tailwind-variants").TVReturnType<{
    [key: string]: {
        [key: string]: import("tailwind-variants").ClassValue | {
            heading?: import("tailwind-variants").ClassValue;
            content?: import("tailwind-variants").ClassValue;
            root?: import("tailwind-variants").ClassValue;
            actions?: import("tailwind-variants").ClassValue;
            total?: import("tailwind-variants").ClassValue;
        };
    };
} | {
    [x: string]: {
        [x: string]: import("tailwind-variants").ClassValue | {
            heading?: import("tailwind-variants").ClassValue;
            content?: import("tailwind-variants").ClassValue;
            root?: import("tailwind-variants").ClassValue;
            actions?: import("tailwind-variants").ClassValue;
            total?: import("tailwind-variants").ClassValue;
        };
    };
} | {}, {
    root: string;
    heading: string;
    content: string;
    total: string;
    actions: string;
}, undefined, {
    [key: string]: {
        [key: string]: import("tailwind-variants").ClassValue | {
            heading?: import("tailwind-variants").ClassValue;
            content?: import("tailwind-variants").ClassValue;
            root?: import("tailwind-variants").ClassValue;
            actions?: import("tailwind-variants").ClassValue;
            total?: import("tailwind-variants").ClassValue;
        };
    };
} | {}, {
    root: string;
    heading: string;
    content: string;
    total: string;
    actions: string;
}, import("tailwind-variants").TVReturnType<unknown, {
    root: string;
    heading: string;
    content: string;
    total: string;
    actions: string;
}, undefined, unknown, unknown, undefined>>;
export type OrderSummaryVariants = VariantProps<typeof orderSummary>;
