import { type VariantProps } from "tailwind-variants";
export declare const glyphLabel: import("tailwind-variants").TVReturnType<{
    role: {
        display: string;
        title: string;
        heading: string;
        body: string;
        label: string;
        code: string;
        caption: string;
        eyebrow: string;
    };
}, undefined, "inline-flex min-w-0 items-center gap-[var(--reddb-glyph-gap)]", {
    role: {
        display: string;
        title: string;
        heading: string;
        body: string;
        label: string;
        code: string;
        caption: string;
        eyebrow: string;
    };
}, undefined, import("tailwind-variants").TVReturnType<{
    role: {
        display: string;
        title: string;
        heading: string;
        body: string;
        label: string;
        code: string;
        caption: string;
        eyebrow: string;
    };
}, undefined, "inline-flex min-w-0 items-center gap-[var(--reddb-glyph-gap)]", unknown, unknown, undefined>>;
export type GlyphLabelVariants = VariantProps<typeof glyphLabel>;
export type GlyphRole = NonNullable<GlyphLabelVariants["role"]>;
export declare const GLYPH_ROLES: readonly ["display", "title", "heading", "body", "label", "code", "caption", "eyebrow"];
