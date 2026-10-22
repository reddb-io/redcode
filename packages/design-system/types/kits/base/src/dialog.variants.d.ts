import { type VariantProps } from "tailwind-variants";
/** Token-only modal surface appearance; behavior remains in Dialog.svelte. */
export declare const dialog: import("tailwind-variants").TVReturnType<{
    size: {
        sm: string;
        md: string;
        lg: string;
        xl: string;
    };
}, undefined, string, {
    size: {
        sm: string;
        md: string;
        lg: string;
        xl: string;
    };
}, undefined, import("tailwind-variants").TVReturnType<{
    size: {
        sm: string;
        md: string;
        lg: string;
        xl: string;
    };
}, undefined, string, unknown, unknown, undefined>>;
/** The standard close control, pinned to the surface's top trailing corner. */
export declare const dialogClose: import("tailwind-variants").TVReturnType<{} | {} | {}, undefined, "absolute top-[var(--reddb-spatial-inset-sm)] right-[var(--reddb-spatial-inset-sm)]", {} | {}, undefined, import("tailwind-variants").TVReturnType<unknown, undefined, "absolute top-[var(--reddb-spatial-inset-sm)] right-[var(--reddb-spatial-inset-sm)]", unknown, unknown, undefined>>;
export type DialogVariants = VariantProps<typeof dialog>;
export type DialogSize = NonNullable<DialogVariants["size"]>;
export declare const DIALOG_SIZES: readonly ["sm", "md", "lg", "xl"];
