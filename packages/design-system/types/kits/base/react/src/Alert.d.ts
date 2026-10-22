import type { ComponentPropsWithRef, ReactNode } from "react";
import type { Tone } from "../../src/tone";
export interface AlertProps extends Omit<ComponentPropsWithRef<"div">, "role" | "title" | "children"> {
    /** What the message means: the shared tone vocabulary (ADR 0026). Defaults to `neutral`. */
    tone?: Tone;
    /** Optional visible heading; this is message content, not the native title tooltip. */
    title?: string;
    /** Extra classes, merged over the canonical tone appearance. */
    className?: string;
    /**
     * The message body, rendered below the optional `title`. Nothing is rendered for it when
     * omitted.
     */
    children?: ReactNode;
}
export declare function Alert({ tone, title, className, children, ...rest }: AlertProps): import("react").JSX.Element;
