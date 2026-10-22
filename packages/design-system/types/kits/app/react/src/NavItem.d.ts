import type { ComponentPropsWithRef, ReactNode } from "react";
import type { NavItemContract } from "../../src/core/contracts/navitem";
interface Content extends NavItemContract {
    /** Decorative leading caller-owned content. */
    icon?: ReactNode;
    /** Trailing caller-owned content. */
    trailing?: ReactNode;
    /** Replaces the label. */
    children?: ReactNode;
    /** Additional root classes. */
    className?: string;
}
export type NavItemProps = Content & (Omit<ComponentPropsWithRef<"a">, keyof Content> | Omit<ComponentPropsWithRef<"button">, keyof Content>);
export declare function NavItem({ label, href, current, disabled, icon, trailing, children, className, ...rest }: NavItemProps): import("react").JSX.Element;
export {};
