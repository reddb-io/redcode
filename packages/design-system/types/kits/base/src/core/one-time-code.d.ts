/** An OTP always has a finite positive integer number of native segments. */
export declare function codeLength(length: number): number;
/** Canonical ASCII alphanumeric entry; the caller's native pattern owns validation. */
export declare function codeCharacters(text: string, limit: number): string[];
/** Keep empty positions while editing; flatten only for the public complete-code value. */
export declare function codeSegments(value: string, length: number): string[];
/** Native keyboard hint shared by both OTP adapters. */
export declare const ONE_TIME_CODE_INPUT_MODES: readonly ["none", "text", "decimal", "numeric", "tel", "search", "email", "url"];
export type OneTimeCodeInputMode = (typeof ONE_TIME_CODE_INPUT_MODES)[number];
