import type { ComponentPropsWithRef, ReactNode } from "react";
import type { SidebarPanelContract } from "../../src/core/contracts/sidebarpanel";
export interface SidebarPanelProps extends SidebarPanelContract, Omit<ComponentPropsWithRef<"section">, keyof SidebarPanelContract | "children"> {
    /** Optional close action; a custom toolbar replaces it. */
    onDismiss?: () => void;
    /** Complete contextual toolbar. */
    toolbar?: ReactNode;
    /** Header actions such as a new conversation or overflow menu. */
    actions?: ReactNode;
    /** Search or filters outside the scrolling region. */
    controls?: ReactNode;
    /** Links, rich rows and labelled groups. */
    children?: ReactNode;
    /** Persistent content below the scrolling region. */
    footer?: ReactNode;
    /** Additional panel classes, including a caller-owned height constraint. */
    className?: string;
}
export declare function SidebarPanel({ title, badge, badgeLabel, badgeTone, status, headingLevel, backHref, backLabel, onDismiss, toolbar, actions, controls, children, footer, className, ...rest }: SidebarPanelProps): import("react").JSX.Element;
