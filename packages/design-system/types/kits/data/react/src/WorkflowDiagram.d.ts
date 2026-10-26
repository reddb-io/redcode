import type { WorkflowDiagramContract } from "../../src/core/contracts/workflowdiagram";
export type { WorkflowData, WorkflowNode, WorkflowPort, WorkflowEdge, } from "../../src/workflow";
export interface WorkflowDiagramProps extends WorkflowDiagramContract {
    /** Additional root classes. */
    className?: string;
}
export declare function WorkflowDiagram({ label, data, direction, selected, focused, interactive, playing, size, onselectedchange, className, }: WorkflowDiagramProps): import("react").JSX.Element;
export default WorkflowDiagram;
