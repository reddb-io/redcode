import { type VariantProps } from "tailwind-variants";
/** Two or three columns that answer to their own container, with no assumptions about their content. */
export declare const multiColumnLayout: import("tailwind-variants").TVReturnType<{
    columns: {
        readonly two: {
            readonly start: "@3xl/multi-column-layout:grow-[1] @3xl/multi-column-layout:basis-0";
            readonly main: "@3xl/multi-column-layout:grow-[2] @3xl/multi-column-layout:basis-0";
            readonly end: "";
        };
        readonly three: {
            readonly start: "@3xl/multi-column-layout:grow-[1] @3xl/multi-column-layout:basis-0";
            readonly main: "@3xl/multi-column-layout:grow-[2] @3xl/multi-column-layout:basis-0";
            readonly end: "@5xl/multi-column-layout:grow-[1] @5xl/multi-column-layout:basis-0";
        };
    };
}, {
    root: string;
    column: string;
    start: string;
    main: string;
    end: string;
}, undefined, {
    columns: {
        readonly two: {
            readonly start: "@3xl/multi-column-layout:grow-[1] @3xl/multi-column-layout:basis-0";
            readonly main: "@3xl/multi-column-layout:grow-[2] @3xl/multi-column-layout:basis-0";
            readonly end: "";
        };
        readonly three: {
            readonly start: "@3xl/multi-column-layout:grow-[1] @3xl/multi-column-layout:basis-0";
            readonly main: "@3xl/multi-column-layout:grow-[2] @3xl/multi-column-layout:basis-0";
            readonly end: "@5xl/multi-column-layout:grow-[1] @5xl/multi-column-layout:basis-0";
        };
    };
}, {
    root: string;
    column: string;
    start: string;
    main: string;
    end: string;
}, import("tailwind-variants").TVReturnType<{
    columns: {
        readonly two: {
            readonly start: "@3xl/multi-column-layout:grow-[1] @3xl/multi-column-layout:basis-0";
            readonly main: "@3xl/multi-column-layout:grow-[2] @3xl/multi-column-layout:basis-0";
            readonly end: "";
        };
        readonly three: {
            readonly start: "@3xl/multi-column-layout:grow-[1] @3xl/multi-column-layout:basis-0";
            readonly main: "@3xl/multi-column-layout:grow-[2] @3xl/multi-column-layout:basis-0";
            readonly end: "@5xl/multi-column-layout:grow-[1] @5xl/multi-column-layout:basis-0";
        };
    };
}, {
    root: string;
    column: string;
    start: string;
    main: string;
    end: string;
}, undefined, unknown, unknown, undefined>>;
export type MultiColumnLayoutVariants = VariantProps<typeof multiColumnLayout>;
export type MultiColumnCount = NonNullable<MultiColumnLayoutVariants["columns"]>;
