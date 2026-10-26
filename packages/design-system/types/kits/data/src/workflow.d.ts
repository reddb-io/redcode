import type { Tone } from "@reddb-io/design-system/base";
export interface WorkflowPort {
    id: string;
    label: string;
    side: "input" | "output";
}
export interface WorkflowNode {
    id: string;
    label: string;
    state: string;
    description?: string;
    progress?: number | null;
    tone?: Tone;
    ports?: readonly WorkflowPort[];
    group?: string;
}
export interface WorkflowEdge {
    id: string;
    label: string;
    source: string;
    target: string;
    sourcePort?: string;
    targetPort?: string;
    bus?: string;
    active?: boolean;
    packetLabel?: string;
}
export interface WorkflowData {
    nodes: readonly WorkflowNode[];
    edges: readonly WorkflowEdge[];
}
export declare const DEFAULT_PORTS: readonly WorkflowPort[];
export declare function workflowLayout(data: WorkflowData, direction: "right" | "down", unit?: number): {
    nodes: {
        portPositions: {
            id: string;
            x: number;
            y: number;
            label: string;
            side: "input" | "output";
        }[];
        x: number;
        y: number;
        width: number;
        height: number;
        paint: {
            inset: number;
            labelY: number;
            stateY: number;
            descriptionY: number;
            progressY: number;
            trackHeight: number;
            radius: number;
            label: string;
            description: string;
        };
        ports: readonly WorkflowPort[];
        percent: number | null;
        id: string;
        label: string;
        state: string;
        description?: string;
        progress?: number | null;
        tone?: Tone;
        group?: string;
    }[];
    edges: {
        path: string;
        start: {
            id: string;
            x: number;
            y: number;
        };
        end: {
            id: string;
            x: number;
            y: number;
        };
        channel: number;
        arrow: string;
        labelX: number;
        labelY: number;
        id: string;
        label: string;
        source: string;
        target: string;
        sourcePort?: string;
        targetPort?: string;
        bus?: string;
        active?: boolean;
        packetLabel?: string;
    }[];
    width: number;
    height: number;
    nodeWidth: number;
    nodeHeight: number;
    related: (id: string) => Set<string>;
};
export declare function workflowFocus(scene: ReturnType<typeof workflowLayout>, id: string | null): {
    x: number;
    y: number;
    width: number;
    height: number;
} | null;
export declare function workflowNodeLabel(node: WorkflowNode): string;
