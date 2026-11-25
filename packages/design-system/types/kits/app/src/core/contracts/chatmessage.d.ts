/** Who speaks in a turn (ADR 0059). */
export declare const CHAT_MESSAGE_SPEAKERS: readonly ["user", "assistant", "system"];
export type ChatMessageSpeaker = (typeof CHAT_MESSAGE_SPEAKERS)[number];
/** Where a turn stands (ADR 0059). */
export declare const CHAT_MESSAGE_STATUSES: readonly ["complete", "streaming", "error", "cancelled"];
export type ChatMessageStatus = (typeof CHAT_MESSAGE_STATUSES)[number];
/** Portable ChatMessage properties shared by native adapters. */
export interface ChatMessageContract {
    /** Visible and accessible author name. */
    author: string;
    /**
         * Image source for the author's avatar. When omitted or unloadable, `avatarFallback` is shown
         * instead.
         */
    avatarSrc?: string;
    /** Visible fallback when the author's image is unavailable. */
    avatarFallback: string;
    /** Machine-readable message timestamp. */
    datetime: string;
    /** Caller-owned visible timestamp. */
    time: string;
    /** Who speaks: a person, an assistant (a model or agent), or the system. Named `speaker`, not `role`, which stays the ARIA attribute. Defaults to `user`. */
    speaker?: ChatMessageSpeaker;
    /** Where the turn stands. While `streaming` the body is busy and its completion is announced once; `error` offers a retry. Defaults to `complete`. */
    status?: ChatMessageStatus;
    /** Visible and accessible label of the retry action shown on an errored turn. Defaults to Retry. */
    retryLabel?: string;
    /** Visible note on a turn the person stopped. Defaults to Stopped. */
    cancelledLabel?: string;
}
