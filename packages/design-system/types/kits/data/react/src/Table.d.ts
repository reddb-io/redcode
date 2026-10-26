import { type ReactNode } from "react";
import { type TableActionsContext, type TableCellContext, type TableChange, type TableFilters, type TableRow, type TableRowKey, type TableSort } from "../../src/table";
import type { TableContract } from "../../src/core/contracts/table";
export * from "../../src/table";
export interface TableProps extends TableContract {
    /** Receives staged immutable edits. */
    onChangesChange?: (changes: readonly TableChange[]) => void;
    /** Reports the sort order. */
    onSortChange?: (sort: TableSort | null) => void;
    /** Reports the column queries. */
    onFiltersChange?: (filters: TableFilters) => void;
    /** Reports a requested page. */
    onPageChange?: (page: number) => void;
    /** Reports row activation. */
    onSelect?: (key: TableRowKey, row: TableRow) => void;
    /** Caller-owned toolbar buttons, menus and controls. */
    actions?: (context: TableActionsContext) => ReactNode;
    /** Caller-owned read-only cell. */
    cell?: (context: TableCellContext) => ReactNode;
    /** Caller-owned empty state. */
    empty?: ReactNode;
    /** Additional table classes. */
    className?: string;
}
export declare function Table(props: TableProps): import("react").JSX.Element;
export default Table;
