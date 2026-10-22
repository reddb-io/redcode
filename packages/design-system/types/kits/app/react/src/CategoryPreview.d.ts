import { type ComponentPropsWithRef, type ReactNode } from "react";
import type { CategoryPreviewContract } from "../../src/core/contracts/categorypreview";
export interface CategoryPreviewProps extends CategoryPreviewContract, Omit<ComponentPropsWithRef<"div">, keyof CategoryPreviewContract | "children"> {
    /** Category imagery with its own accessible alternative. */
    media: ReactNode;
    /** Additional Card classes. */
    className?: string;
}
export declare function CategoryPreview({ name, href, description, media, ratio, headingLevel, className, ...rest }: CategoryPreviewProps): import("react").JSX.Element;
