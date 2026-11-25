import { type VariantProps } from "tailwind-variants";
/** The prompt composer's surface (ADR 0059): one field, settings and the send or stop action. */
export declare const promptComposer: import("tailwind-variants").TVReturnType<{
    [key: string]: {
        [key: string]: import("tailwind-variants").ClassValue | {
            footer?: import("tailwind-variants").ClassValue;
            root?: import("tailwind-variants").ClassValue;
            send?: import("tailwind-variants").ClassValue;
            field?: import("tailwind-variants").ClassValue;
            selectors?: import("tailwind-variants").ClassValue;
        };
    };
} | {
    [x: string]: {
        [x: string]: import("tailwind-variants").ClassValue | {
            footer?: import("tailwind-variants").ClassValue;
            root?: import("tailwind-variants").ClassValue;
            send?: import("tailwind-variants").ClassValue;
            field?: import("tailwind-variants").ClassValue;
            selectors?: import("tailwind-variants").ClassValue;
        };
    };
} | {}, {
    root: string;
    field: string;
    footer: string;
    selectors: string;
    send: string;
}, undefined, {
    [key: string]: {
        [key: string]: import("tailwind-variants").ClassValue | {
            footer?: import("tailwind-variants").ClassValue;
            root?: import("tailwind-variants").ClassValue;
            send?: import("tailwind-variants").ClassValue;
            field?: import("tailwind-variants").ClassValue;
            selectors?: import("tailwind-variants").ClassValue;
        };
    };
} | {}, {
    root: string;
    field: string;
    footer: string;
    selectors: string;
    send: string;
}, import("tailwind-variants").TVReturnType<unknown, {
    root: string;
    field: string;
    footer: string;
    selectors: string;
    send: string;
}, undefined, unknown, unknown, undefined>>;
export type PromptComposerVariants = VariantProps<typeof promptComposer>;
