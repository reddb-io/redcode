import { type ComponentPropsWithRef } from "react";
import { type IconGlyph } from "./Icon";
import { type AvatarContract } from "../../src/core/avatar";
interface SharedProps extends AvatarContract, Omit<ComponentPropsWithRef<"span">, "children"> {
    /** Decorative content alternative used whenever the image is unavailable. */
    icon?: IconGlyph;
    /** Extra classes merged onto the avatar root. */
    className?: string;
}
export type AvatarProps = SharedProps & ({
    icon: IconGlyph;
    fallback?: string;
} | {
    icon?: undefined;
    fallback: string;
});
export declare function Avatar({ src, name, icon, fallback, size, className, imageClass, fallbackClass, ...rest }: AvatarProps): import("react").JSX.Element;
export {};
