import { type VisualizationItem } from "./visualization";
export interface SequenceParticipant extends VisualizationItem {
}
export interface SequenceMessage extends VisualizationItem {
    source: string;
    target: string;
    kind?: "call" | "return" | "async";
}
export interface SequenceData {
    participants: readonly SequenceParticipant[];
    messages: readonly SequenceMessage[];
}
export declare function sequenceData(data: SequenceData): SequenceData;
