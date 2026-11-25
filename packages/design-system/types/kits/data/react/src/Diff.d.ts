import { type RecordDiffProps } from "./RecordDiff";
export { diffFields, diffLines, formatDiffValue } from "../../src/diff";
export type { DiffEntry, DiffKind, DiffResult, DiffSummary, } from "../../src/diff";
/** Deprecated alias of `RecordDiffProps` (ADR 0007), removed in the next month release. */
export type DiffProps = RecordDiffProps;
/** Deprecated alias of `RecordDiff` (ADR 0007), removed in the next month release. */
export declare function Diff(props: DiffProps): import("react").JSX.Element;
export default Diff;
