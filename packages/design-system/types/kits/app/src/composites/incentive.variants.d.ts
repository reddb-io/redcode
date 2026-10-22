import { type VariantProps } from "tailwind-variants";
/** Token-only extension seams around canonical MediaObject and SectionHeading. */
export declare const incentive: import("tailwind-variants").TVReturnType<{
    [key: string]: {
        [key: string]: import("tailwind-variants").ClassValue | {
            heading?: import("tailwind-variants").ClassValue;
            content?: import("tailwind-variants").ClassValue;
            root?: import("tailwind-variants").ClassValue;
            icon?: import("tailwind-variants").ClassValue;
        };
    };
} | {
    [x: string]: {
        [x: string]: import("tailwind-variants").ClassValue | {
            heading?: import("tailwind-variants").ClassValue;
            content?: import("tailwind-variants").ClassValue;
            root?: import("tailwind-variants").ClassValue;
            icon?: import("tailwind-variants").ClassValue;
        };
    };
} | {}, {
    root: string;
    icon: string;
    content: string;
    heading: string;
}, undefined, {
    [key: string]: {
        [key: string]: import("tailwind-variants").ClassValue | {
            heading?: import("tailwind-variants").ClassValue;
            content?: import("tailwind-variants").ClassValue;
            root?: import("tailwind-variants").ClassValue;
            icon?: import("tailwind-variants").ClassValue;
        };
    };
} | {}, {
    root: string;
    icon: string;
    content: string;
    heading: string;
}, import("tailwind-variants").TVReturnType<unknown, {
    root: string;
    icon: string;
    content: string;
    heading: string;
}, undefined, unknown, unknown, undefined>>;
export type IncentiveVariants = VariantProps<typeof incentive>;
