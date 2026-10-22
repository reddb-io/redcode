import type { ComponentPropsWithRef, ReactNode } from "react";
import type { ListRowContract } from "../../src/core/contracts/listrow";
interface Content extends ListRowContract {
    /** Content before the text, such as an icon or avatar. */
    leading?: ReactNode;
    /** Content after the text, pushed to the row's end. */
    trailing?: ReactNode;
    /** Replaces the title and description. */
    children?: ReactNode;
    /** Additional root classes. */
    className?: string;
}
export type ListRowProps = Content & (Omit<ComponentPropsWithRef<"a">, keyof Content> | Omit<ComponentPropsWithRef<"button">, keyof Content> | Omit<ComponentPropsWithRef<"div">, keyof Content>);
export declare function ListRow({ title, description, href, size, selected, leading, trailing, children, className, ...rest }: ListRowProps): import("react").JSX.Element;
export {};
