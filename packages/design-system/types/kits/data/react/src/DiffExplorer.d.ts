import type { DiffExplorerContract } from "../../src/core/contracts/diffexplorer";
export { explorerFields, filterExplorerEntries, formatExplorerValue, summarizeExplorerEntries } from "../../src/diff-explorer";
export type { DiffExplorerEntry, DiffExplorerField } from "../../src/diff-explorer";
export interface DiffExplorerProps extends DiffExplorerContract {
    /** Extra root classes. */
    className?: string;
}
export declare function DiffExplorer({ label, entries, context, emptyLabel, className }: DiffExplorerProps): import("react").JSX.Element;
export default DiffExplorer;
