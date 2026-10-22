import type { Tone } from "@reddb-io/design-system/base";
export interface PropertyItem {
    /** Stable name of the property. */ label: string;
    /** Caller-formatted reading, never an editor. */ value: string | number;
}
export interface PhaseGate {
    /** Stable identity. */ id: string;
    /** Visible gate name. */ label: string;
    /** Explicit state; completion is not inferred from work progress. */ state: "pending" | "running" | "passed" | "failed";
    /** Optional context or approval requirement. */ description?: string;
}
export declare const GATE_LABELS: {
    readonly pending: "Pending";
    readonly running: "Running";
    readonly passed: "Passed";
    readonly failed: "Failed";
};
export declare const GATE_TONES: Record<PhaseGate["state"], Tone>;
export declare function validateGates(gates: readonly PhaseGate[]): readonly PhaseGate[];
export declare const PLAYBACK_SPEEDS: readonly [{
    readonly value: "0.5";
    readonly label: "0.5×";
}, {
    readonly value: "1";
    readonly label: "1×";
}, {
    readonly value: "2";
    readonly label: "2×";
}, {
    readonly value: "4";
    readonly label: "4×";
}];
