import type { Tone } from "@reddb-io/design-system/base";
/** One answer to an approval request. */
export interface ApprovalDecision {
    /** Value reported when chosen. */
    value: string;
    /** Visible and accessible label, e.g. "Allow once". */
    label: string;
    /** What the decision means; `danger` for a destructive allowance. Defaults to neutral. */
    tone?: Tone;
    /** Whether this is the recommended answer, drawn as the primary action. */
    primary?: boolean;
}
/** Portable ApprovalPrompt properties shared by native adapters (ADR 0059). */
export interface ApprovalPromptContract {
    /** What is being asked, e.g. "Run `rm -rf dist`?". Names the region and is announced on arrival. */
    title: string;
    /** Why it is asked, or what follows. */
    description?: string;
    /** The answers, in reading order. */
    decisions: readonly ApprovalDecision[];
    /** Whether an answer is being applied; the decisions are unavailable meanwhile. */
    pending?: boolean;
}
