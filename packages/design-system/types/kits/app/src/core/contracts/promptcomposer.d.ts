/** Where the composer's request stands (ADR 0059). */
export declare const PROMPT_COMPOSER_STATUSES: readonly ["idle", "submitting", "streaming"];
export type PromptComposerStatus = (typeof PROMPT_COMPOSER_STATUSES)[number];
/** One choice of a composer selector. */
export interface PromptComposerOption {
    /** Submitted value. */
    value: string;
    /** Visible name. */
    label: string;
    /** Present but unavailable. */
    disabled?: boolean;
}
/** A setting chosen beside the prompt: model, agent, effort or permission are all instances. */
export interface PromptComposerSelector {
    /** Stable identity, reported with every change. */
    id: string;
    /** Accessible name of the setting. */
    label: string;
    /** Current value. */
    value: string;
    /** Available choices. */
    options: readonly PromptComposerOption[];
}
/** Portable PromptComposer properties shared by native adapters (ADR 0059). */
export interface PromptComposerContract {
    /** Accessible name of the prompt field. */
    label: string;
    /** Current prompt text; leave unset for an uncontrolled composer. */
    value?: string;
    /** Initial text of an uncontrolled composer. Defaults to empty. */
    defaultValue?: string;
    /** Hint shown in the empty field. */
    placeholder?: string;
    /** Where the request stands: `submitting` disables sending, `streaming` turns Send into Stop. Defaults to idle. */
    status?: PromptComposerStatus;
    /** Settings shown beside the prompt, each a native select. */
    selectors?: readonly PromptComposerSelector[];
    /** Rows the field grows to before it scrolls. Defaults to 8. */
    maxRows?: number;
    /** Whether the whole composer is unavailable. */
    disabled?: boolean;
    /** Visible and accessible label of the send action. Defaults to Send. */
    submitLabel?: string;
    /** Visible and accessible label of the stop action while streaming. Defaults to Stop. */
    stopLabel?: string;
}
/** Whether a keydown in the field should send: Enter without Shift, never while an IME composes. */
export declare function shouldSubmitPrompt(event: {
    key: string;
    shiftKey: boolean;
    isComposing?: boolean;
    keyCode?: number;
}): boolean;
