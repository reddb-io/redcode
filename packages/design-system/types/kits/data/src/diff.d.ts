/** Pure field and line comparison for the dependency-free Data Kit Diff viewer. */
export type DiffKind = "added" | "removed" | "changed" | "unchanged";
export interface DiffEntry {
    path: string;
    kind: DiffKind;
    before?: unknown;
    after?: unknown;
}
export interface DiffSummary {
    added: number;
    removed: number;
    changed: number;
    unchanged: number;
}
export interface DiffResult {
    entries: readonly DiffEntry[];
    summary: DiffSummary;
}
/** Stable text presentation shared by every Diff mode. */
export declare function formatDiffValue(value: unknown): string;
/** Compare recursively flattened fields in stable before-then-after order. */
export declare function diffFields(before: unknown, after: unknown): DiffResult;
/** Compare lines with LCS alignment, pairing adjacent replacement blocks as changes. */
export declare function diffLines(before: string, after: string): DiffResult;
