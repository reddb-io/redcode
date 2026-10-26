import { type VisualizationItem } from "./visualization";
export interface MatrixAxis {
    id: string;
    label: string;
}
export interface MatrixCell extends VisualizationItem {
    row: string;
    column: string;
    value: number | null;
}
export declare function matrixData(rows: readonly MatrixAxis[], columns: readonly MatrixAxis[], data: readonly MatrixCell[]): readonly MatrixCell[];
