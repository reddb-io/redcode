import type { ReactNode } from "react";
import type { ApplicationWorkspaceContract } from "../../src/core/contracts/applicationworkspace";
export interface ApplicationWorkspaceProps extends ApplicationWorkspaceContract {
    /** Caller-owned resource navigation. */
    navigation?: ReactNode;
    /** Caller-owned commands or contextual controls above the documents. */
    toolbar?: ReactNode;
    /** Content for each caller-owned document. */
    children?: (item: {
        id: string;
    }) => ReactNode;
    /** Alternative caller-owned content when no document list is supplied. */
    content?: ReactNode;
    /** Additional classes on the navigation region. */
    navigationClass?: string;
    /** Additional classes on the content region. */
    contentClass?: string;
    /** Additional classes on the workspace root. */
    className?: string;
}
export declare function ApplicationWorkspace({ label, landmarks, navigationLabel, documentLabel, items, selected, onselectedchange, oncloserequest, emptyLabel, panelClass, navigation, toolbar, children, content, navigationClass, contentClass, className }: ApplicationWorkspaceProps): import("react").JSX.Element;
