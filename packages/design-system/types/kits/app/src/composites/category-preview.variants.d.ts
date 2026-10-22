import { type VariantProps } from "tailwind-variants";
/** Token-only presentation around canonical Card, AspectRatio, and Link contracts. */
export declare const categoryPreview: import("tailwind-variants").TVReturnType<{
    [key: string]: {
        [key: string]: import("tailwind-variants").ClassValue | {
            content?: import("tailwind-variants").ClassValue;
            root?: import("tailwind-variants").ClassValue;
            name?: import("tailwind-variants").ClassValue;
            media?: import("tailwind-variants").ClassValue;
            description?: import("tailwind-variants").ClassValue;
        };
    };
} | {
    [x: string]: {
        [x: string]: import("tailwind-variants").ClassValue | {
            content?: import("tailwind-variants").ClassValue;
            root?: import("tailwind-variants").ClassValue;
            name?: import("tailwind-variants").ClassValue;
            media?: import("tailwind-variants").ClassValue;
            description?: import("tailwind-variants").ClassValue;
        };
    };
} | {}, {
    root: string;
    media: string;
    content: string;
    name: string;
    description: string;
}, undefined, {
    [key: string]: {
        [key: string]: import("tailwind-variants").ClassValue | {
            content?: import("tailwind-variants").ClassValue;
            root?: import("tailwind-variants").ClassValue;
            name?: import("tailwind-variants").ClassValue;
            media?: import("tailwind-variants").ClassValue;
            description?: import("tailwind-variants").ClassValue;
        };
    };
} | {}, {
    root: string;
    media: string;
    content: string;
    name: string;
    description: string;
}, import("tailwind-variants").TVReturnType<unknown, {
    root: string;
    media: string;
    content: string;
    name: string;
    description: string;
}, undefined, unknown, unknown, undefined>>;
export type CategoryPreviewVariants = VariantProps<typeof categoryPreview>;
