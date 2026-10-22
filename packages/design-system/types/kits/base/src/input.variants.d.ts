import { type VariantProps } from "tailwind-variants";
export declare const input: import("tailwind-variants").TVReturnType<{
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
export type InputVariants = VariantProps<typeof input>;
export type InputSize = NonNullable<InputVariants["size"]>;
export declare const INPUT_SIZES: readonly ["sm", "md", "lg"];
