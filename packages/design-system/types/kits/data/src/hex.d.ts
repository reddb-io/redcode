/** Pure byte normalization and aligned row formatting for the Hex viewer. */
export type HexInput = ArrayBuffer | Uint8Array | readonly number[];
export interface HexRow {
    offset: string;
    hex: string;
    ascii: string;
}
/** Copy binary input into an immutable byte sequence for rendering. */
export declare function hexBytes(value: HexInput): Uint8Array;
/** Format offset, hexadecimal, and printable-ASCII columns at fixed widths. */
export declare function formatHex(value: HexInput, bytesPerRow?: number): readonly HexRow[];
