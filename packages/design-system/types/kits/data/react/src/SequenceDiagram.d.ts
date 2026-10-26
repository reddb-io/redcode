export type { VisualizationSize, VisualizationSeries, } from "../../src/visualization";
export type { SequenceData, SequenceParticipant, SequenceMessage, } from "../../src/sequence-diagram";
import type { SequenceDiagramContract } from "../../src/core/contracts/sequencediagram";
export interface SequenceDiagramProps extends SequenceDiagramContract {
    /** Reports selection for application-owned filtering or detail navigation. */
    onSelectedChange?: (id: string) => void;
    /** Extra classes on the outer figure. */
    className?: string;
}
export declare function SequenceDiagram(props: SequenceDiagramProps): import("react").JSX.Element;
export default SequenceDiagram;
