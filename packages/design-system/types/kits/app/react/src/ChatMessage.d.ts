import { type ComponentPropsWithRef, type ReactNode } from "react";
import type { ChatMessageContract } from "../../src/core/contracts/chatmessage";
export interface ChatMessageProps extends ChatMessageContract, Omit<ComponentPropsWithRef<"article">, keyof ChatMessageContract | "children"> {
    /** Caller-authored message body; the caller renders markdown or code (ADR 0059). */
    children: ReactNode;
    /** Actions after the body. */
    actions?: ReactNode;
    /** Called when the person retries an errored turn. */
    onRetry?: () => void;
    /** Additional article classes. */
    className?: string;
}
export declare function ChatMessage({ author, avatarSrc, avatarFallback, datetime, time, speaker, status, retryLabel, cancelledLabel, children, actions, onRetry, className, ...rest }: ChatMessageProps): import("react").JSX.Element;
