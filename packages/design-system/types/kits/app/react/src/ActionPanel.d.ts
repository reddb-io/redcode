import type { ComponentPropsWithRef, ReactNode } from "react";
import type { ActionPanelContract } from "../../src/core/contracts/actionpanel";
export interface ActionPanelProps extends ActionPanelContract, Omit<ComponentPropsWithRef<"div">, keyof ActionPanelContract | "children"> {
    /** Canonical links and controls in the action region. */
    actions: ReactNode;
    /** Optional content between heading and actions. */
    children?: ReactNode;
    /** Additional surface classes. */
    className?: string;
}
export declare function ActionPanel({ title, description, level, variant, padding, actions, children, className, ...rest }: ActionPanelProps): import("react").JSX.Element;
