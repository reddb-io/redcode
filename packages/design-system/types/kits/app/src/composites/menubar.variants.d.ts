import { type DropdownMenuSize } from "@reddb-io/design-system/base/recipes";
import { type VariantProps } from "tailwind-variants";
export declare const menubar: import("tailwind-variants").TVReturnType<{
    [key: string]: {
        [key: string]: import("tailwind-variants").ClassValue | {
            content?: import("tailwind-variants").ClassValue;
            root?: import("tailwind-variants").ClassValue;
        };
    };
} | {
    size: {
        sm: import("tailwind-variants").ClassValue | {
            content?: import("tailwind-variants").ClassValue;
            root?: import("tailwind-variants").ClassValue;
        };
        md: import("tailwind-variants").ClassValue | {
            content?: import("tailwind-variants").ClassValue;
            root?: import("tailwind-variants").ClassValue;
        };
        lg: import("tailwind-variants").ClassValue | {
            content?: import("tailwind-variants").ClassValue;
            root?: import("tailwind-variants").ClassValue;
        };
    };
}, {
    root: string;
    content: string;
}, undefined, {
    size: {
        sm: {
            item: string;
            icon: string;
        };
        md: {
            item: string;
            icon: string;
        };
        lg: {
            item: string;
            icon: string;
        };
    };
}, {
    content: string;
    group: string;
    heading: string;
    separator: string;
    item: string;
    icon: string;
    label: string;
    shortcut: string;
}, import("tailwind-variants").TVReturnType<{
    size: {
        sm: {
            item: string;
            icon: string;
        };
        md: {
            item: string;
            icon: string;
        };
        lg: {
            item: string;
            icon: string;
        };
    };
}, {
    content: string;
    group: string;
    heading: string;
    separator: string;
    item: string;
    icon: string;
    label: string;
    shortcut: string;
}, undefined, {
    size: {
        sm: {
            item: string;
            icon: string;
        };
        md: {
            item: string;
            icon: string;
        };
        lg: {
            item: string;
            icon: string;
        };
    };
}, {
    content: string;
    group: string;
    heading: string;
    separator: string;
    item: string;
    icon: string;
    label: string;
    shortcut: string;
}, import("tailwind-variants").TVReturnType<{
    size: {
        sm: {
            item: string;
            icon: string;
        };
        md: {
            item: string;
            icon: string;
        };
        lg: {
            item: string;
            icon: string;
        };
    };
}, {
    content: string;
    group: string;
    heading: string;
    separator: string;
    item: string;
    icon: string;
    label: string;
    shortcut: string;
}, undefined, unknown, unknown, undefined>>>;
export type MenubarVariants = VariantProps<typeof menubar>;
export type MenubarSize = DropdownMenuSize;
