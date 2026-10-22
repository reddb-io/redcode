import { type VariantProps } from "tailwind-variants";
/**
 * Token-only arrangement around canonical Base form contracts. Form and
 * Fieldset own the rhythm between their own children (ADR 0024): rows sit
 * `layout-gap-md` apart and a group's fields `layout-gap-sm`, so neither the
 * root nor a section re-spaces them.
 */
export declare const checkoutForm: import("tailwind-variants").TVReturnType<{
    [key: string]: {
        [key: string]: import("tailwind-variants").ClassValue | {
            section?: import("tailwind-variants").ClassValue;
            root?: import("tailwind-variants").ClassValue;
            error?: import("tailwind-variants").ClassValue;
            actions?: import("tailwind-variants").ClassValue;
        };
    };
} | {
    [x: string]: {
        [x: string]: import("tailwind-variants").ClassValue | {
            section?: import("tailwind-variants").ClassValue;
            root?: import("tailwind-variants").ClassValue;
            error?: import("tailwind-variants").ClassValue;
            actions?: import("tailwind-variants").ClassValue;
        };
    };
} | {}, {
    root: string;
    error: string;
    section: string;
    actions: string;
}, undefined, {
    [key: string]: {
        [key: string]: import("tailwind-variants").ClassValue | {
            section?: import("tailwind-variants").ClassValue;
            root?: import("tailwind-variants").ClassValue;
            error?: import("tailwind-variants").ClassValue;
            actions?: import("tailwind-variants").ClassValue;
        };
    };
} | {}, {
    root: string;
    error: string;
    section: string;
    actions: string;
}, import("tailwind-variants").TVReturnType<unknown, {
    root: string;
    error: string;
    section: string;
    actions: string;
}, undefined, unknown, unknown, undefined>>;
export type CheckoutFormVariants = VariantProps<typeof checkoutForm>;
