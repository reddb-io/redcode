import type { ReactNode } from "react";
import type { PropertyPanelContract } from "../../src/core/contracts/propertypanel";
export interface PropertyPanelProps extends PropertyPanelContract {
    /** Caller-owned panel actions. */
    actions?: ReactNode;
    /** Additional root classes. */
    className?: string;
}
export declare function PropertyPanel({ title, items, description, actions, className, }: PropertyPanelProps): import("react").JSX.Element;
