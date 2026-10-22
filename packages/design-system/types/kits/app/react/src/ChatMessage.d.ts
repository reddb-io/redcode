import type { ComponentPropsWithRef, ReactNode } from "react";
import type { ChatMessageContract } from "../../src/core/contracts/chatmessage";
export interface ChatMessageProps extends ChatMessageContract, Omit<ComponentPropsWithRef<"article">, keyof ChatMessageContract | "children"> {
    /** Caller-authored message body. */
    children: ReactNode;
    /** Actions after the body. */
    actions?: ReactNode;
    /** Additional article classes. */
    className?: string;
}
export declare function ChatMessage({ author, avatarSrc, avatarFallback, datetime, time, children, actions, className, ...rest }: ChatMessageProps): import("react").JSX.Element;
