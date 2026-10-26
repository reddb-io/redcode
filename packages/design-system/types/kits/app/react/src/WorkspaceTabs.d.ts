import { type ReactNode } from "react";
import type { WorkspaceTabsContract } from "../../src/core/contracts/workspacetabs";
export type { WorkspaceTab } from "../../src/core/workspace-tabs";
export interface WorkspaceTabsProps extends WorkspaceTabsContract {
    /** Native content per document; inactive panels remain mounted and hidden. */
    children?: (item: {
        id: string;
    }) => ReactNode;
    /** Additional composition classes. */
    className?: string;
}
export declare function WorkspaceTabs({ label, items, selected, onselectedchange, oncloserequest, closeLabel, dirtyLabel, busyLabel, emptyLabel, children, className, }: WorkspaceTabsProps): import("react").JSX.Element;
export default WorkspaceTabs;
