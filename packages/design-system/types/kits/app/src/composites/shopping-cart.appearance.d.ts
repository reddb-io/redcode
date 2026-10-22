import { type VariantProps } from "tailwind-variants";
/**
 * Token-only arrangement around canonical Base form and list contracts. The
 * Form owns the rhythm between the cart's rows (ADR 0024), so the root adds
 * none. Each item puts its controls beside its details while they fit and
 * wraps them below when they do not — a flex-wrap measured against the item's
 * own width, never the window's (ADR 0021).
 */
export declare const shoppingCart: import("tailwind-variants").TVReturnType<{
    [key: string]: {
        [key: string]: import("tailwind-variants").ClassValue | {
            details?: import("tailwind-variants").ClassValue;
            heading?: import("tailwind-variants").ClassValue;
            root?: import("tailwind-variants").ClassValue;
            name?: import("tailwind-variants").ClassValue;
            media?: import("tailwind-variants").ClassValue;
            list?: import("tailwind-variants").ClassValue;
            description?: import("tailwind-variants").ClassValue;
            actions?: import("tailwind-variants").ClassValue;
            item?: import("tailwind-variants").ClassValue;
            controls?: import("tailwind-variants").ClassValue;
            total?: import("tailwind-variants").ClassValue;
            empty?: import("tailwind-variants").ClassValue;
            identity?: import("tailwind-variants").ClassValue;
            price?: import("tailwind-variants").ClassValue;
            itemActions?: import("tailwind-variants").ClassValue;
            quantity?: import("tailwind-variants").ClassValue;
        };
    };
} | {
    [x: string]: {
        [x: string]: import("tailwind-variants").ClassValue | {
            details?: import("tailwind-variants").ClassValue;
            heading?: import("tailwind-variants").ClassValue;
            root?: import("tailwind-variants").ClassValue;
            name?: import("tailwind-variants").ClassValue;
            media?: import("tailwind-variants").ClassValue;
            list?: import("tailwind-variants").ClassValue;
            description?: import("tailwind-variants").ClassValue;
            actions?: import("tailwind-variants").ClassValue;
            item?: import("tailwind-variants").ClassValue;
            controls?: import("tailwind-variants").ClassValue;
            total?: import("tailwind-variants").ClassValue;
            empty?: import("tailwind-variants").ClassValue;
            identity?: import("tailwind-variants").ClassValue;
            price?: import("tailwind-variants").ClassValue;
            itemActions?: import("tailwind-variants").ClassValue;
            quantity?: import("tailwind-variants").ClassValue;
        };
    };
} | {}, {
    root: string;
    heading: string;
    list: string;
    item: string;
    details: string;
    media: string;
    identity: string;
    name: string;
    description: string;
    price: string;
    controls: string;
    itemActions: string;
    quantity: string;
    empty: string;
    total: string;
    actions: string;
}, undefined, {
    [key: string]: {
        [key: string]: import("tailwind-variants").ClassValue | {
            details?: import("tailwind-variants").ClassValue;
            heading?: import("tailwind-variants").ClassValue;
            root?: import("tailwind-variants").ClassValue;
            name?: import("tailwind-variants").ClassValue;
            media?: import("tailwind-variants").ClassValue;
            list?: import("tailwind-variants").ClassValue;
            description?: import("tailwind-variants").ClassValue;
            actions?: import("tailwind-variants").ClassValue;
            item?: import("tailwind-variants").ClassValue;
            controls?: import("tailwind-variants").ClassValue;
            total?: import("tailwind-variants").ClassValue;
            empty?: import("tailwind-variants").ClassValue;
            identity?: import("tailwind-variants").ClassValue;
            price?: import("tailwind-variants").ClassValue;
            itemActions?: import("tailwind-variants").ClassValue;
            quantity?: import("tailwind-variants").ClassValue;
        };
    };
} | {}, {
    root: string;
    heading: string;
    list: string;
    item: string;
    details: string;
    media: string;
    identity: string;
    name: string;
    description: string;
    price: string;
    controls: string;
    itemActions: string;
    quantity: string;
    empty: string;
    total: string;
    actions: string;
}, import("tailwind-variants").TVReturnType<unknown, {
    root: string;
    heading: string;
    list: string;
    item: string;
    details: string;
    media: string;
    identity: string;
    name: string;
    description: string;
    price: string;
    controls: string;
    itemActions: string;
    quantity: string;
    empty: string;
    total: string;
    actions: string;
}, undefined, unknown, unknown, undefined>>;
export type ShoppingCartVariants = VariantProps<typeof shoppingCart>;
