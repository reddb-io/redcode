import { type VariantProps } from "tailwind-variants";
export declare const prose: import("tailwind-variants").TVReturnType<{
    measure: {
        readonly prose: "max-w-prose";
        readonly content: "max-w-content";
        readonly full: "max-w-none";
    };
    striped: {
        true: string;
        false: string;
    };
}, undefined, string, {
    measure: {
        readonly prose: "max-w-prose";
        readonly content: "max-w-content";
        readonly full: "max-w-none";
    };
    striped: {
        true: string;
        false: string;
    };
}, undefined, import("tailwind-variants").TVReturnType<{
    measure: {
        readonly prose: "max-w-prose";
        readonly content: "max-w-content";
        readonly full: "max-w-none";
    };
    striped: {
        true: string;
        false: string;
    };
}, undefined, string, unknown, unknown, undefined>>;
export type ProseVariants = VariantProps<typeof prose>;
export type ProseMeasure = NonNullable<ProseVariants["measure"]>;
export declare const PROSE_MEASURES: readonly ProseMeasure[];
/** The elements Prose may render as: a neutral block, or a document landmark. */
export declare const PROSE_ELEMENTS: readonly ["div", "article", "section"];
export type ProseElement = (typeof PROSE_ELEMENTS)[number];
