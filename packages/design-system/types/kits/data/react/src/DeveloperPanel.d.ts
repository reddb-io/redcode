import { type ReactNode } from "react";
import type { DeveloperRequest } from "../../src/developer-panel";
import type { DeveloperPanelContract } from "../../src/core/contracts/developerpanel";
export type { DeveloperRequest, RequestPhase } from "../../src/developer-panel";
export interface DeveloperPanelProps extends DeveloperPanelContract {
    /** Called when the expanded state changes. */
    onOpenChange?: (open: boolean) => void;
    /** Legacy callback for clearing the request log.
       * @deprecated Use `contextContent` to compose DeveloperRequestInspector with this handler; removed next release. */
    onRequestsChange?: (requests: readonly DeveloperRequest[]) => void;
    /** Caller-owned panel content; the legacy requests prop renders it in the Tools view. */
    children?: ReactNode;
    /** Body for a host-defined context, receiving its value. */
    contextContent?: (item: {
        value: string;
    }) => ReactNode;
    /** Optional toolbar below the header for the current context. */
    contextToolbar?: (item: {
        value: string;
    }) => ReactNode;
    /** Legacy actions for the selected request.
       * @deprecated Use `contextContent` to compose DeveloperRequestInspector with these actions; removed next release. */
    requestActions?: (request: DeveloperRequest) => ReactNode;
    /** Optional header controls before the close button. */
    headerActions?: ReactNode;
    /** Extra root classes. */
    className?: string;
}
export declare function DeveloperPanel(props: DeveloperPanelProps): import("react").JSX.Element;
export default DeveloperPanel;
