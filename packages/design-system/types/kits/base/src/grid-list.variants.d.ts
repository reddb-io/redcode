import { type VariantProps } from "tailwind-variants";
export declare const GRID_LIST_COLUMNS: readonly [1, 2, 3, 4];
export type GridListColumn = (typeof GRID_LIST_COLUMNS)[number];
export declare const gridList: import("tailwind-variants").TVReturnType<{
    columns: {
        1: string;
        2: string;
        3: string;
        4: string;
    };
}, undefined, "grid w-full", {
    columns: {
        1: string;
        2: string;
        3: string;
        4: string;
    };
}, undefined, import("tailwind-variants").TVReturnType<{
    columns: {
        1: string;
        2: string;
        3: string;
        4: string;
    };
}, undefined, "grid w-full", unknown, unknown, undefined>>;
export type GridListVariants = VariantProps<typeof gridList>;
