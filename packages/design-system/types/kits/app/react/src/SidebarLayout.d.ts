import { type ComponentPropsWithRef, type ReactNode } from "react";
import type { SidebarLayoutContract } from "../../src/core/contracts/sidebarlayout";
import { type PrimaryNavigationItem } from "../../src/composites/navigation.behavior";
export interface SidebarLayoutProps extends SidebarLayoutContract, Omit<ComponentPropsWithRef<"div">, keyof SidebarLayoutContract | "children"> {
    /** Contextual content, receiving the open section and the close operation. */
    sidebar?: (context: {
        item: PrimaryNavigationItem | undefined;
        close: () => void;
    }) => ReactNode;
    /** Product-wide header whose disclosures share this layout's navigation scope. */
    header?: ReactNode;
    /** Optional workspace rail; mutually exclusive with primary navigation items. */
    rail?: ReactNode;
    /** Reports mobile panel opening and dismissal requests. */
    onPanelOpenChange?: (open: boolean) => void;
    /** Caller-owned page content. */
    children?: ReactNode;
    /** Additional layout classes. */
    className?: string;
}
export declare function SidebarLayout(props: SidebarLayoutProps): import("react").JSX.Element;
