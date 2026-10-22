import type { ComponentPropsWithRef, ReactNode } from "react";
import { type HeadingLevel, type HeadingRole } from "../../src/heading.variants";
export interface HeadingProps extends Omit<ComponentPropsWithRef<"h2">, "role"> {
    /** Heading text or inline content, required by the common contract. */
    children: ReactNode;
    /** Document outline level, independent from its appearance. */
    level?: HeadingLevel;
    /** Theme type role; title at level 1, heading otherwise. */
    role?: HeadingRole;
}
export declare function Heading({ level, role, className, ...rest }: HeadingProps): import("react").JSX.Element;
