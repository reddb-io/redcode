import { type ReactNode } from "react";
import { type TerminalInteraction, type TerminalSessionHandle } from "../../src/terminal-session";
import type { TerminalSessionContract } from "../../src/core/contracts/terminalsession";
export type { TerminalAppearance, TerminalEngine, TerminalEngineFactory, TerminalEngineOptions, TerminalInteraction, TerminalSessionHandle, } from "../../src/terminal-session";
export interface TerminalSessionProps extends TerminalSessionContract {
    /** Reports a live handle, then null when the corresponding adapter is disposed. */
    onSessionChange?: (session: TerminalSessionHandle | null) => void;
    /** Application-owned input and valid terminal cell-size events. */
    onInteraction?: (interaction: TerminalInteraction) => void;
    /** Caller-owned header controls without implicit connection actions. */
    actions?: ReactNode;
    /** Additional session-region classes. */
    className?: string;
}
export declare function TerminalSession(props: TerminalSessionProps): import("react").JSX.Element;
export default TerminalSession;
