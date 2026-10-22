import { type VariantProps } from "tailwind-variants";
/** One application filter offered by the single-active Filter surface. */
export interface FilterOption {
    /** Stable submitted value. */
    value: string;
    /** Visible option name. */
    label: string;
    /** Present but unavailable to pointer and keyboard selection. */
    disabled?: boolean;
}
/** Token-only arrangement around the canonical Base ToggleGroup. */
export declare const filter: import("tailwind-variants").TVReturnType<{
    [key: string]: {
        [key: string]: import("tailwind-variants").ClassValue | {
            root?: import("tailwind-variants").ClassValue;
            list?: import("tailwind-variants").ClassValue;
        };
    };
} | {
    [x: string]: {
        [x: string]: import("tailwind-variants").ClassValue | {
            root?: import("tailwind-variants").ClassValue;
            list?: import("tailwind-variants").ClassValue;
        };
    };
} | {}, {
    root: string;
    list: string;
}, undefined, {
    [key: string]: {
        [key: string]: import("tailwind-variants").ClassValue | {
            root?: import("tailwind-variants").ClassValue;
            list?: import("tailwind-variants").ClassValue;
        };
    };
} | {}, {
    root: string;
    list: string;
}, import("tailwind-variants").TVReturnType<unknown, {
    root: string;
    list: string;
}, undefined, unknown, unknown, undefined>>;
export type FilterVariants = VariantProps<typeof filter>;
