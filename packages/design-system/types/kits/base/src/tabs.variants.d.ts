import { type VariantProps } from "tailwind-variants";
export interface TabItem {
    value: string;
    label: string;
    disabled?: boolean;
}
export declare const tabs: import("tailwind-variants").TVReturnType<{
    [key: string]: {
        [key: string]: import("tailwind-variants").ClassValue | {
            content?: import("tailwind-variants").ClassValue;
            root?: import("tailwind-variants").ClassValue;
            list?: import("tailwind-variants").ClassValue;
            trigger?: import("tailwind-variants").ClassValue;
        };
    };
} | {
    [x: string]: {
        [x: string]: import("tailwind-variants").ClassValue | {
            content?: import("tailwind-variants").ClassValue;
            root?: import("tailwind-variants").ClassValue;
            list?: import("tailwind-variants").ClassValue;
            trigger?: import("tailwind-variants").ClassValue;
        };
    };
} | {}, {
    root: string;
    list: string;
    trigger: string;
    content: string;
}, undefined, {
    [key: string]: {
        [key: string]: import("tailwind-variants").ClassValue | {
            content?: import("tailwind-variants").ClassValue;
            root?: import("tailwind-variants").ClassValue;
            list?: import("tailwind-variants").ClassValue;
            trigger?: import("tailwind-variants").ClassValue;
        };
    };
} | {}, {
    root: string;
    list: string;
    trigger: string;
    content: string;
}, import("tailwind-variants").TVReturnType<unknown, {
    root: string;
    list: string;
    trigger: string;
    content: string;
}, undefined, unknown, unknown, undefined>>;
export type TabsVariants = VariantProps<typeof tabs>;
