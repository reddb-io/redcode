import { type ReactNode } from "react";
import type { ApprovalPromptContract } from "../../src/core/contracts/approvalprompt";
export interface ApprovalPromptProps extends ApprovalPromptContract {
    /** Called with the chosen decision's value. */
    onDecide?: (value: string) => void;
    /** Optional caller-owned preview of what would run: a command, a diff. */
    request?: ReactNode;
    /** Extra classes merged over the root. */
    className?: string;
}
/** An agent asks before it acts (ADR 0059): a non-modal region announced on arrival that never takes focus. */
export declare function ApprovalPrompt({ title, description, decisions, pending, onDecide, request, className }: ApprovalPromptProps): import("react").JSX.Element;
