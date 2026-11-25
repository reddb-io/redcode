import type { ReactNode } from "react";
import { type ToolActivityContract, type ToolStep } from "../../src/core/contracts/toolactivity";
export interface ToolActivityProps extends ToolActivityContract {
    /** Called when the steps are shown or hidden. */
    onOpenChange?: (open: boolean) => void;
    /** Optional caller-owned detail under a step (its output or diff). */
    detail?: (step: ToolStep) => ReactNode;
    /** Extra classes merged over the root. */
    className?: string;
}
/** What an agent did on a turn: a caller-localised summary that discloses its steps (ADR 0059). */
export declare function ToolActivity({ summary, steps, open, statusLabels, onOpenChange, detail, className }: ToolActivityProps): import("react").JSX.Element;
