import { type VariantProps } from "tailwind-variants";
/** One independently selectable category in a CategoryFilter. */
export interface CategoryFilterOption {
    /** Stable native form value. */
    value: string;
    /** Visible category name. */
    label: string;
    /** Present but unavailable to pointer and keyboard selection. */
    disabled?: boolean;
}
/** Token-only arrangement around canonical Base Fieldset and Checkbox contracts. */
export declare const categoryFilter: import("tailwind-variants").TVReturnType<{
    [key: string]: {
        [key: string]: import("tailwind-variants").ClassValue | {
            option?: import("tailwind-variants").ClassValue;
            root?: import("tailwind-variants").ClassValue;
            list?: import("tailwind-variants").ClassValue;
        };
    };
} | {
    [x: string]: {
        [x: string]: import("tailwind-variants").ClassValue | {
            option?: import("tailwind-variants").ClassValue;
            root?: import("tailwind-variants").ClassValue;
            list?: import("tailwind-variants").ClassValue;
        };
    };
} | {}, {
    root: string;
    list: string;
    option: string;
}, undefined, {
    [key: string]: {
        [key: string]: import("tailwind-variants").ClassValue | {
            option?: import("tailwind-variants").ClassValue;
            root?: import("tailwind-variants").ClassValue;
            list?: import("tailwind-variants").ClassValue;
        };
    };
} | {}, {
    root: string;
    list: string;
    option: string;
}, import("tailwind-variants").TVReturnType<unknown, {
    root: string;
    list: string;
    option: string;
}, undefined, unknown, unknown, undefined>>;
export type CategoryFilterVariants = VariantProps<typeof categoryFilter>;
