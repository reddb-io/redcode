import type { KeyValueExplorerContract } from "../../src/core/contracts/keyvalueexplorer";
export type { KvEntry } from "../../src/key-value-explorer";
export interface KeyValueExplorerProps extends KeyValueExplorerContract {
    /** Extra root classes. */
    className?: string;
}
export declare function KeyValueExplorer({ label, entries, context, emptyLabel, className, }: KeyValueExplorerProps): import("react").JSX.Element;
export default KeyValueExplorer;
