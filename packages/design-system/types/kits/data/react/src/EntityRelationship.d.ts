export type { SchemaData, SchemaEntity, SchemaField, SchemaRelation, } from "../../src/schema-diagram";
export type { VisualizationSize } from "../../src/visualization";
import type { EntityRelationshipContract } from "../../src/core/contracts/entityrelationship";
export interface EntityRelationshipProps extends EntityRelationshipContract {
    /** Reports selection for application-owned filtering or detail navigation. */
    onSelectedChange?: (id: string) => void;
    /** Extra classes on the outer figure. */
    className?: string;
}
export declare function EntityRelationship(props: EntityRelationshipProps): import("react").JSX.Element;
export default EntityRelationship;
