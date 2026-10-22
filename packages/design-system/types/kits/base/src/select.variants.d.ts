import { type VariantProps } from "tailwind-variants";
export declare const select: import("tailwind-variants").TVReturnType<{
    size: {
        sm: string;
        md: string;
        lg: string;
    };
}, undefined, string, {
    size: {
        sm: string;
        md: string;
        lg: string;
    };
}, undefined, import("tailwind-variants").TVReturnType<{
    size: {
        sm: string;
        md: string;
        lg: string;
    };
}, undefined, string, unknown, unknown, undefined>>;
export type SelectVariants = VariantProps<typeof select>;
export type SelectSize = NonNullable<SelectVariants["size"]>;
