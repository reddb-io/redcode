import { type VisualizationItem } from "./visualization";
export interface SchemaField {
    id: string;
    label: string;
    type: string;
    primaryKey?: boolean;
    foreignKey?: boolean;
    unique?: boolean;
    nullable?: boolean;
}
export interface SchemaEntity extends VisualizationItem {
    fields: readonly SchemaField[];
    group?: string;
    kind?: "entity" | "table" | "join" | "aggregate";
    indexes?: readonly string[];
    x?: number;
    y?: number;
}
export interface SchemaRelation extends VisualizationItem {
    source: string;
    target: string;
    sourceField?: string;
    targetField?: string;
    sourceCardinality?: string;
    targetCardinality?: string;
    onDelete?: "CASCADE" | "RESTRICT" | "SET NULL" | "NO ACTION";
}
export interface SchemaData {
    entities: readonly SchemaEntity[];
    relations: readonly SchemaRelation[];
}
export declare function schemaLayout(data: SchemaData, width: number, fieldLimit?: number, unit?: number): {
    nodes: {
        x: number;
        y: number;
        visible: SchemaField[];
        width: number;
        height: number;
        row: number;
        index: number;
        header: number;
        rowHeight: number;
        inset: number;
        fields: readonly SchemaField[];
        group?: string;
        kind?: "entity" | "table" | "join" | "aggregate";
        indexes?: readonly string[];
        id: string;
        label: string;
        description?: string;
        series?: import("./visualization").VisualizationSeries;
        href?: string;
    }[];
    height: number;
};
