import { type ReactNode } from "react";
import type { DeveloperPanelContract } from "../../src/core/contracts/developerpanel";
export type { DeveloperRequest, RequestPhase } from "../../src/developer-panel";
export interface DeveloperPanelProps extends DeveloperPanelContract {
    /** Called when the expanded state changes. */
    onOpenChange?: (open: boolean) => void;
    /** Caller-owned panel content, shown when no `contextContent` is supplied. */
    children?: ReactNode;
    /** Body for a host-defined context, receiving its value. */
    contextContent?: (item: {
        value: string;
    }) => ReactNode;
    /** Optional toolbar below the header for the current context. */
    contextToolbar?: (item: {
        value: string;
    }) => ReactNode;
    /** Optional header controls before the close button. */
    headerActions?: ReactNode;
    /** Extra root classes. */
    className?: string;
}
export declare function DeveloperPanel(props: DeveloperPanelProps): import("react").JSX.Element;
export default DeveloperPanel;
