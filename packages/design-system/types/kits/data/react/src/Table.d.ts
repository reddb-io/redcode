import { type DataTableProps } from "./DataTable";
export * from "../../src/table";
/** Deprecated alias of `DataTableProps` (ADR 0007), removed in the next month release. */
export type TableProps = DataTableProps;
/** Deprecated alias of `DataTable` (ADR 0007), removed in the next month release. */
export declare function Table(props: TableProps): import("react").JSX.Element;
export default Table;
