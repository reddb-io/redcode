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
    overflow: {
        wrap: string;
        collapse: string;
    };
}, {
    root: string;
    item: string;
    more: string;
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
    overflow: {
        wrap: string;
        collapse: string;
    };
}, {
    root: string;
    item: string;
    more: string;
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
    overflow: {
        wrap: string;
        collapse: string;
    };
}, {
    root: string;
    item: string;
    more: string;
}, undefined, unknown, unknown, undefined>>;
export type ToolbarVariants = VariantProps<typeof toolbar>;
export type ToolbarSize = NonNullable<ToolbarVariants["size"]>;
export type ToolbarOverflow = NonNullable<ToolbarVariants["overflow"]>;
