import type { ComponentPropsWithRef, ReactNode } from "react";
import type { CardPadding, CardVariant } from "../../src/card.variants";
export interface ListContainerProps extends Omit<ComponentPropsWithRef<"div">, "title" | "children"> {
    /** Edge treatment of the underlying Card: `outline` (the default) or `plain`. */
    variant?: CardVariant;
    /** Density-owned inset applied to every Card section. Defaults to `md`. */
    padding?: CardPadding;
    /** Header title, rendered when no `header` content is given. */
    title?: string;
    /** Supporting line under the title. */
    description?: string;
    /** Full control over the header. Replaces `title` and `description`. */
    header?: ReactNode;
    /** Caller-owned actions or content rendered after the list. */
    footer?: ReactNode;
    /** Extra classes merged onto the underlying Card surface. */
    className?: string;
    /** The list itself, rendered in the Card body. */
    children?: ReactNode;
}
export declare function ListContainer({ variant, padding, title, description, header, footer, className, children, ...rest }: ListContainerProps): import("react").JSX.Element;
