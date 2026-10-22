import { type VariantProps } from "tailwind-variants";
/** Token-only layout around the canonical Popover and Combobox appearances. */
export declare const commandPalette: import("tailwind-variants").TVReturnType<{
    [key: string]: {
        [key: string]: import("tailwind-variants").ClassValue | {
            search?: import("tailwind-variants").ClassValue;
            content?: import("tailwind-variants").ClassValue;
            root?: import("tailwind-variants").ClassValue;
        };
    };
} | {
    [x: string]: {
        [x: string]: import("tailwind-variants").ClassValue | {
            search?: import("tailwind-variants").ClassValue;
            content?: import("tailwind-variants").ClassValue;
            root?: import("tailwind-variants").ClassValue;
        };
    };
} | {}, {
    root: string;
    content: string;
    search: string;
}, undefined, {
    [key: string]: {
        [key: string]: import("tailwind-variants").ClassValue | {
            search?: import("tailwind-variants").ClassValue;
            content?: import("tailwind-variants").ClassValue;
            root?: import("tailwind-variants").ClassValue;
        };
    };
} | {}, {
    root: string;
    content: string;
    search: string;
}, import("tailwind-variants").TVReturnType<unknown, {
    root: string;
    content: string;
    search: string;
}, undefined, unknown, unknown, undefined>>;
export type CommandPaletteVariants = VariantProps<typeof commandPalette>;
