import type { NavigationMenuContract } from "../../src/core/contracts/navigationmenu";
export interface NavigationMenuProps extends NavigationMenuContract {
    /** Reports the open section id, or an empty string when none is open. */
    onValueChange?: (value: string) => void;
    /** Additional classes on each anchored surface. */
    className?: string;
}
export declare function NavigationMenu(props: NavigationMenuProps): import("react").JSX.Element;
