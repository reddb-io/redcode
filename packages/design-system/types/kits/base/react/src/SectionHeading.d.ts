import type { ComponentPropsWithRef, ReactNode } from "react";
import { type SectionHeadingLevel, type SectionHeadingSize } from "../../src/section-heading.variants";
export interface SectionHeadingProps extends Omit<ComponentPropsWithRef<"div">, "title"> {
    /** Heading text. */
    title: string;
    /** Supporting paragraph, omitted when empty. */
    description?: string;
    /** Heading id for an enclosing landmark's aria-labelledby. */
    titleId?: string;
    /** Document outline depth, independent from visual size. */
    level?: SectionHeadingLevel;
    /** Visual title size. */
    size?: SectionHeadingSize;
    /** Draw the divider and retain its spacing. */
    rule?: boolean;
    /** Trailing caller-owned actions. */
    actions?: ReactNode;
}
export declare function SectionHeading({ title, description, titleId, level, size, rule, actions, className, ...rest }: SectionHeadingProps): import("react").JSX.Element;
