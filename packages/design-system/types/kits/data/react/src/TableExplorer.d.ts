import type { TableExplorerContract } from "../../src/core/contracts/tableexplorer";
export interface TableExplorerProps extends TableExplorerContract {
    /** Called when the person retries after a failed load. */
    onretry?: () => void;
    /** Extra root classes. */
    className?: string;
}
export declare function TableExplorer({ label, columns, rows, rowKey, total, context, error, editable, changes, onchangeschange, queryColumns, onquery, onreset, describequery, identityLabel, state, errorMessage, retryLabel, loadingRows, onretry, className, }: TableExplorerProps): import("react").JSX.Element;
export default TableExplorer;
