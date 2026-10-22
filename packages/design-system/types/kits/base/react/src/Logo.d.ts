import { type ComponentPropsWithRef } from "react";
import { type LogoLayout, type LogoSurface } from "../../src/logo.marks";
export type { LogoLayout, LogoSurface } from "../../src/logo.marks";
interface Common {
    /** How the Brand Mark is laid out. */
    layout?: LogoLayout;
    /** Local surface behind the Mark; omitted, follows the document Color Scheme. */
    on?: LogoSurface;
    /** Symbol height in CSS pixels, with mandatory clearspace added to the box. */
    size?: number;
    /** Fetch the Mark eagerly in a masthead or lazily in a footer. */
    loading?: "eager" | "lazy";
    /** Browser fetch priority for the Mark. */
    fetchpriority?: "high" | "low" | "auto";
}
type MarkMode = Common & Omit<ComponentPropsWithRef<"span">, "children"> & {
    href?: never;
    label?: never;
};
type LinkMode = Common & Omit<ComponentPropsWithRef<"a">, "children" | "href"> & {
    /** Destination of the accessible home link. */
    href: string;
    /** Accessible link name. */
    label?: string;
};
export type LogoProps = MarkMode | LinkMode;
export declare function Logo({ layout, on, size, loading, fetchpriority, label, className, style, ...rest }: LogoProps): import("react").JSX.Element;
