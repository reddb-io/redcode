import { type ComponentPropsWithRef, type ReactNode } from "react";
import type { TableColumn, TableRow, TableCellContext } from "../../src/core/table";
export type { TableColumn, TableRow, TableCellContext, TableCellValue } from "../../src/core/table";
export interface TableProps extends Omit<ComponentPropsWithRef<"table">, "children"> {
    /** Required visible name for the table. */
    caption: string;
    /** Columns rendered in this order with native column-header scope. */
    columns: readonly TableColumn[];
    /** Caller-owned tabular values. */
    rows: readonly TableRow[];
    /** Column key whose body cells are native row headers. Defaults to the first column. */
    rowHeader?: string;
    /** Caller-owned rendering for each cell; native cell relationships remain Table-owned. */
    cell?: (context: TableCellContext) => ReactNode;
    /** Extra classes merged onto the native table. */
    className?: string;
    /** Extra classes merged onto the responsive scroll region. */
    containerClass?: string;
    /** Extra classes merged onto the `<caption>`, over its own. */
    captionClass?: string;
    /** Extra classes merged onto the `<thead>`, over its own. */
    headerClass?: string;
    /** Extra classes merged onto every row, the header row and each body row. */
    rowClass?: string;
    /** Extra classes merged onto each column header cell. */
    headClass?: string;
    /** Extra classes merged onto each body cell, row-header cells included. */
    cellClass?: string;
}
export declare function Table({ caption, columns, rows, rowHeader, cell, className, containerClass, captionClass, headerClass, rowClass, headClass, cellClass, ...rest }: TableProps): import("react").JSX.Element;
