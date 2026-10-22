import { type VariantProps } from "tailwind-variants";
export declare const scrollArea: import("tailwind-variants").TVReturnType<{
    orientation: {
        readonly vertical: "overflow-x-hidden overflow-y-auto";
        readonly horizontal: "overflow-x-auto overflow-y-hidden";
        readonly both: "overflow-auto";
    };
    variant: {
        outline: string;
        plain: string;
    };
}, undefined, string, {
    orientation: {
        readonly vertical: "overflow-x-hidden overflow-y-auto";
        readonly horizontal: "overflow-x-auto overflow-y-hidden";
        readonly both: "overflow-auto";
    };
    variant: {
        outline: string;
        plain: string;
    };
}, undefined, import("tailwind-variants").TVReturnType<{
    orientation: {
        readonly vertical: "overflow-x-hidden overflow-y-auto";
        readonly horizontal: "overflow-x-auto overflow-y-hidden";
        readonly both: "overflow-auto";
    };
    variant: {
        outline: string;
        plain: string;
    };
}, undefined, string, unknown, unknown, undefined>>;
export type ScrollAreaVariants = VariantProps<typeof scrollArea>;
export type ScrollAreaOrientation = NonNullable<ScrollAreaVariants["orientation"]>;
export declare const SCROLL_AREA_ORIENTATIONS: readonly ScrollAreaOrientation[];
