import type { IsometricBlockContract } from "../../src/core/contracts/isometricblock";
export interface IsometricBlockProps extends IsometricBlockContract {
    /** Additional root classes. */
    className?: string;
}
export declare function IsometricBlock({ label, width, depth, height, series, className, }: IsometricBlockProps): import("react").JSX.Element;
export default IsometricBlock;
