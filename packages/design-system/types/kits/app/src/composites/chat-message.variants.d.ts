import { type VariantProps } from "tailwind-variants";
/** Density-responsive message rhythm around canonical Base media contracts. */
export declare const chatMessage: import("tailwind-variants").TVReturnType<{
    [key: string]: {
        [key: string]: import("tailwind-variants").ClassValue | {
            body?: import("tailwind-variants").ClassValue;
            content?: import("tailwind-variants").ClassValue;
            root?: import("tailwind-variants").ClassValue;
            header?: import("tailwind-variants").ClassValue;
            time?: import("tailwind-variants").ClassValue;
            actions?: import("tailwind-variants").ClassValue;
            author?: import("tailwind-variants").ClassValue;
        };
    };
} | {
    [x: string]: {
        [x: string]: import("tailwind-variants").ClassValue | {
            body?: import("tailwind-variants").ClassValue;
            content?: import("tailwind-variants").ClassValue;
            root?: import("tailwind-variants").ClassValue;
            header?: import("tailwind-variants").ClassValue;
            time?: import("tailwind-variants").ClassValue;
            actions?: import("tailwind-variants").ClassValue;
            author?: import("tailwind-variants").ClassValue;
        };
    };
} | {}, {
    root: string;
    content: string;
    header: string;
    author: string;
    time: string;
    body: string;
    actions: string;
}, undefined, {
    [key: string]: {
        [key: string]: import("tailwind-variants").ClassValue | {
            body?: import("tailwind-variants").ClassValue;
            content?: import("tailwind-variants").ClassValue;
            root?: import("tailwind-variants").ClassValue;
            header?: import("tailwind-variants").ClassValue;
            time?: import("tailwind-variants").ClassValue;
            actions?: import("tailwind-variants").ClassValue;
            author?: import("tailwind-variants").ClassValue;
        };
    };
} | {}, {
    root: string;
    content: string;
    header: string;
    author: string;
    time: string;
    body: string;
    actions: string;
}, import("tailwind-variants").TVReturnType<unknown, {
    root: string;
    content: string;
    header: string;
    author: string;
    time: string;
    body: string;
    actions: string;
}, undefined, unknown, unknown, undefined>>;
export type ChatMessageVariants = VariantProps<typeof chatMessage>;
