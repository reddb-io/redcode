import type { PhoneCountry } from "./contracts/phoneinput";
import type { SearchSelectOption } from "../search-select.variants";
export type { PhoneCountry } from "./contracts/phoneinput";
export interface PhoneState {
    country: PhoneCountry;
    display: string;
    value: string;
    international: string;
    possible: boolean;
}
/** An empty allowlist is a configuration error, never an implicit unrestricted selector. */
export declare function phoneCountries(countries?: readonly PhoneCountry[]): readonly PhoneCountry[];
/** Unicode flag is decorative; the selector always also names the country and calling code. */
export declare function phoneFlag(country: PhoneCountry): string;
export declare function phoneCountryName(country: PhoneCountry, locale?: string): string;
/** Search accepts localized/English names, ISO code and calling code. No network or location inference.
 * Before hydration, use ISO ordering/names: host ICU versions can disagree on translations and sort order. */
export declare function phoneCountryOptions(countries: readonly PhoneCountry[], locale?: string, localized?: boolean): readonly SearchSelectOption[];
/** Preserve the actual international prefix when pasting; never silently prepend the old country's code. */
export declare function phoneState(text: string, fallback: PhoneCountry): PhoneState;
export declare function phoneProblem(state: PhoneState, countries: readonly PhoneCountry[], required: boolean, requiredMessage: string, invalidMessage: string): string;
/** Count decimal digits rather than punctuation when preserving a selection through a mask. */
export declare function phoneDigitCount(value: string): number;
export declare function phoneCaret(display: string, digits: number): number;
/** Delete the adjacent digit when Backspace/Delete would otherwise merely remove an auto-inserted separator. */
export declare function phoneSeparatorDeletion(display: string, type: string, start: number, end: number): {
    text: string;
    digits: number;
} | undefined;
/** Native editing mechanics shared by both adapters: caret, paste, IME and separator deletion. */
export declare function bindPhoneEditing(element: HTMLInputElement, initial: PhoneState, changed: (next: PhoneState, previous: PhoneState) => void): {
    sync(next: PhoneState): void;
    destroy(): void;
};
/** Keep the selected country accurate even when an international paste is outside the allowlist. */
export declare function phoneOptions(countries: readonly PhoneCountry[], country: PhoneCountry, locale: string, localized?: boolean): readonly SearchSelectOption[];
/** Focus only the first invalid control when native form validation reports several errors. */
export declare function phoneInvalid(element: HTMLInputElement): void;
