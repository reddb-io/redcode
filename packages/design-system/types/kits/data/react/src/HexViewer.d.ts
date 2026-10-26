export { formatHex, hexBytes } from "../../src/hex";
export type { HexInput, HexRow } from "../../src/hex";
import type { HexViewerContract } from "../../src/core/contracts/hexviewer";
export interface HexViewerProps extends HexViewerContract {
    /** Extra classes, merged onto the root `section`. */
    className?: string;
}
export declare function HexViewer(props: HexViewerProps): import("react").JSX.Element;
export default HexViewer;
