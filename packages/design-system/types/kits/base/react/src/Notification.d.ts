import { type ComponentPropsWithRef, type ReactNode } from "react";
import type { Tone } from "../../src/tone";
export interface NotificationProps extends Omit<ComponentPropsWithRef<"div">, "title" | "children"> {
    /** What the notification means, announced with Alert's canonical urgency. Defaults to `neutral`. */
    tone?: Tone;
    /** Required announcement text. */
    title: string;
    /** Optional caller-owned detail. */
    children?: ReactNode;
    /** Accessible and visible label for the dismissal control. */
    dismissLabel?: string;
    /** Called after the notification removes itself. */
    onDismiss?: () => void;
    /** Extra classes merged over the notification root. */
    className?: string;
}
export declare function Notification({ tone, title, children, dismissLabel, onDismiss, className, ...rest }: NotificationProps): import("react").JSX.Element | null;
