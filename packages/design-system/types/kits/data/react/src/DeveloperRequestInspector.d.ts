import { type ReactNode } from "react";
import type { DeveloperRequest } from "../../src/developer-panel";
export type { DeveloperRequest, RequestPhase } from "../../src/developer-panel";
export interface DeveloperRequestInspectorProps {
    /** Sanitized request snapshot in chronological order, owned by the host. */
    requests: readonly DeveloperRequest[];
    /** Called when the user asks to clear the request log. */
    onRequestsChange?: (requests: readonly DeveloperRequest[]) => void;
    /** Host-owned controls for the selected request. */
    requestActions?: (request: DeveloperRequest) => ReactNode;
    /** Optional host content in the Tools detail view. */
    children?: ReactNode;
}
export declare function DeveloperRequestInspector({ requests, onRequestsChange, requestActions, children }: DeveloperRequestInspectorProps): import("react").JSX.Element;
export default DeveloperRequestInspector;
