import { type VariantProps } from "tailwind-variants";
export declare const DIFF_MODES: readonly ["inline", "side-by-side"];
export type DiffMode = (typeof DIFF_MODES)[number];
export type DiffChangeKind = "context" | "addition" | "removal" | "empty";
export declare const diff: import("tailwind-variants").TVReturnType<{
    change: Record<DiffChangeKind, string>;
}, {
    root: string;
    split: string;
    pane: string;
    heading: string;
    lines: string;
    line: string;
    marker: string;
}, undefined, {
    change: Record<DiffChangeKind, string>;
}, {
    root: string;
    split: string;
    pane: string;
    heading: string;
    lines: string;
    line: string;
    marker: string;
}, import("tailwind-variants").TVReturnType<{
    change: Record<DiffChangeKind, string>;
}, {
    root: string;
    split: string;
    pane: string;
    heading: string;
    lines: string;
    line: string;
    marker: string;
}, undefined, unknown, unknown, undefined>>;
export type DiffVariants = VariantProps<typeof diff>;
