import { type VariantProps } from "tailwind-variants";
export declare const actionPanel: import("tailwind-variants").TVReturnType<{
    [key: string]: {
        [key: string]: import("tailwind-variants").ClassValue | {
            heading?: import("tailwind-variants").ClassValue;
            content?: import("tailwind-variants").ClassValue;
            root?: import("tailwind-variants").ClassValue;
            actions?: import("tailwind-variants").ClassValue;
        };
    };
} | {
    [x: string]: {
        [x: string]: import("tailwind-variants").ClassValue | {
            heading?: import("tailwind-variants").ClassValue;
            content?: import("tailwind-variants").ClassValue;
            root?: import("tailwind-variants").ClassValue;
            actions?: import("tailwind-variants").ClassValue;
        };
    };
} | {}, {
    root: string;
    heading: string;
    content: string;
    actions: string;
}, undefined, {
    [key: string]: {
        [key: string]: import("tailwind-variants").ClassValue | {
            heading?: import("tailwind-variants").ClassValue;
            content?: import("tailwind-variants").ClassValue;
            root?: import("tailwind-variants").ClassValue;
            actions?: import("tailwind-variants").ClassValue;
        };
    };
} | {}, {
    root: string;
    heading: string;
    content: string;
    actions: string;
}, import("tailwind-variants").TVReturnType<unknown, {
    root: string;
    heading: string;
    content: string;
    actions: string;
}, undefined, unknown, unknown, undefined>>;
export type ActionPanelVariants = VariantProps<typeof actionPanel>;
