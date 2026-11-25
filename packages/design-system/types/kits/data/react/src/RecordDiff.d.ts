export { diffFields, diffLines, formatDiffValue } from "../../src/diff";
export type { DiffEntry, DiffKind, DiffResult, DiffSummary, } from "../../src/diff";
import type { DiffContract } from "../../src/core/contracts/diff";
export interface RecordDiffProps extends DiffContract {
    /** Extra classes, merged onto the root `section`. */
    className?: string;
}
export declare function RecordDiff(props: RecordDiffProps): import("react").JSX.Element;
export default RecordDiff;
