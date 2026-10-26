import { type ReactNode } from "react";
import type { EntityInspectorContract } from "../../src/core/contracts/entityinspector";
export type { InspectorEntity } from "../../src/core/entity-inspector";
export interface EntityInspectorProps extends EntityInspectorContract {
    /** Caller-owned details for the selected entity. */
    children?: ReactNode;
    /** Caller-owned actions below the selected entity details. */
    actions?: ReactNode;
    /** Additional root classes, including application-owned height constraints. */
    className?: string;
}
export declare function EntityInspector({ label, items, selected, context, onselectedchange, ondismiss, previousLabel, nextLabel, closeLabel, emptyLabel, headingLevel, children, actions, className, }: EntityInspectorProps): import("react").JSX.Element;
export default EntityInspector;
