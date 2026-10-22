import { type VariantProps } from "tailwind-variants";
export declare const sidebarNavigation: import("tailwind-variants").TVReturnType<{
    [key: string]: {
        [key: string]: import("tailwind-variants").ClassValue | {
            root?: import("tailwind-variants").ClassValue;
            list?: import("tailwind-variants").ClassValue;
            toolbar?: import("tailwind-variants").ClassValue;
            item?: import("tailwind-variants").ClassValue;
        };
    };
} | {
    [x: string]: {
        [x: string]: import("tailwind-variants").ClassValue | {
            root?: import("tailwind-variants").ClassValue;
            list?: import("tailwind-variants").ClassValue;
            toolbar?: import("tailwind-variants").ClassValue;
            item?: import("tailwind-variants").ClassValue;
        };
    };
} | {}, {
    root: string;
    toolbar: string;
    list: string;
    item: string;
}, undefined, {
    [key: string]: {
        [key: string]: import("tailwind-variants").ClassValue | {
            root?: import("tailwind-variants").ClassValue;
            list?: import("tailwind-variants").ClassValue;
            toolbar?: import("tailwind-variants").ClassValue;
            item?: import("tailwind-variants").ClassValue;
        };
    };
} | {}, {
    root: string;
    toolbar: string;
    list: string;
    item: string;
}, import("tailwind-variants").TVReturnType<unknown, {
    root: string;
    toolbar: string;
    list: string;
    item: string;
}, undefined, unknown, unknown, undefined>>;
export type SidebarNavigationVariants = VariantProps<typeof sidebarNavigation>;
