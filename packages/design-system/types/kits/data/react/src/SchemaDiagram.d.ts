export type { SchemaData, SchemaEntity, SchemaField, SchemaRelation, } from "../../src/schema-diagram";
export type { VisualizationSize } from "../../src/visualization";
import type { SchemaDiagramContract } from "../../src/core/contracts/schemadiagram";
export interface SchemaDiagramProps extends SchemaDiagramContract {
    /** Reports selection for application-owned filtering or detail navigation. */
    onSelectedChange?: (id: string) => void;
    /** Extra classes on the outer figure. */
    className?: string;
}
export declare function SchemaDiagram(props: SchemaDiagramProps): import("react").JSX.Element;
export default SchemaDiagram;
