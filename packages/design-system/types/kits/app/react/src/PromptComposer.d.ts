import { type ComponentPropsWithRef } from "react";
import { type PromptComposerContract } from "../../src/core/contracts/promptcomposer";
export interface PromptComposerProps extends PromptComposerContract, Omit<ComponentPropsWithRef<"form">, keyof PromptComposerContract | "onSubmit"> {
    /** Called with the new text on every keystroke. */
    onValueChange?: (value: string) => void;
    /** Called with the prompt when the person sends it (Enter, or the send action). */
    onSendRequest?: (value: string) => void;
    /** Called when the person stops a streaming reply. */
    onStopRequest?: () => void;
    /** Called when a setting changes, with the selector's id and its new value. */
    onSelectorChange?: (id: string, value: string) => void;
}
/** The field a person writes a prompt in, with its settings and one send action that becomes Stop while the reply streams (ADR 0059). */
export declare function PromptComposer({ label, value, defaultValue, placeholder, status, selectors, maxRows, disabled, submitLabel, stopLabel, onValueChange, onSendRequest, onStopRequest, onSelectorChange, className, ...rest }: PromptComposerProps): import("react").JSX.Element;
