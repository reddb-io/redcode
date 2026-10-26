export { diffFields, diffLines, formatDiffValue } from "../../src/diff";
export type { DiffEntry, DiffKind, DiffResult, DiffSummary, } from "../../src/diff";
import type { DiffContract } from "../../src/core/contracts/diff";
export interface DiffProps extends DiffContract {
    /** Extra classes, merged onto the root `section`. */
    className?: string;
}
export declare function Diff(props: DiffProps): import("react").JSX.Element;
export default Diff;
