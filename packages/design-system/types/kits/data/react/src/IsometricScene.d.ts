import type { IsometricSceneContract } from "../../src/core/contracts/isometricscene";
export type { IsometricItem } from "../../src/isometric";
export interface IsometricSceneProps extends IsometricSceneContract {
    /** Additional root classes. */
    className?: string;
}
export declare function IsometricScene({ label, items, selected, focused, layer, interactive, size, onselectedchange, className, }: IsometricSceneProps): import("react").JSX.Element;
export default IsometricScene;
