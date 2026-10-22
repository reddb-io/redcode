import { type ReactNode } from "react";
import { type NavigationSeam } from "../../src/core/navigation";
export declare const NavigationContext: import("react").Context<NavigationSeam | undefined>;
export declare function useNavigation(): NavigationSeam | undefined;
export interface NavigationScopeProps extends NavigationSeam {
    /** Content whose in-app links are activated through the injected seam. */
    children?: ReactNode;
}
export declare function NavigationScope({ navigate, resolve, owns, children }: NavigationScopeProps): import("react").JSX.Element;
