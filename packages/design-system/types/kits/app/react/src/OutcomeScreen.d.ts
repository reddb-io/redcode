import type { ReactNode } from "react";
import type { OutcomeScreenContract } from "../../src/core/contracts/outcomescreen";
export interface OutcomeScreenProps extends OutcomeScreenContract {
    /** Optional product identity, supplied by the host. */
    identity?: ReactNode;
    /** Caller-owned recovery, continuation or close controls. */
    actions?: ReactNode;
    /** Extra classes on the outer region. */
    className?: string;
}
export declare function OutcomeScreen({ outcome, title, description, note, fullPage, headingLevel, illustration, identity, actions, className }: OutcomeScreenProps): import("react").JSX.Element;
