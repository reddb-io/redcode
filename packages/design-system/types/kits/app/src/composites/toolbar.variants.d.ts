import { type VariantProps } from "tailwind-variants";
export declare const toolbar: import("tailwind-variants").TVReturnType<{
    orientation: {
        horizontal: string;
        vertical: {
            root: string;
        };
    };
    size: {
        sm: {
            item: string;
        };
        md: {
            item: string;
        };
        lg: {
            item: string;
        };
    };
}, {
    root: string;
    item: string;
}, undefined, {
    orientation: {
        horizontal: string;
        vertical: {
            root: string;
        };
    };
    size: {
        sm: {
            item: string;
        };
        md: {
            item: string;
        };
        lg: {
            item: string;
        };
    };
}, {
    root: string;
    item: string;
}, import("tailwind-variants").TVReturnType<{
    orientation: {
        horizontal: string;
        vertical: {
            root: string;
        };
    };
    size: {
        sm: {
            item: string;
        };
        md: {
            item: string;
        };
        lg: {
            item: string;
        };
    };
}, {
    root: string;
    item: string;
}, undefined, unknown, unknown, undefined>>;
export type ToolbarVariants = VariantProps<typeof toolbar>;
export type ToolbarSize = NonNullable<ToolbarVariants["size"]>;
