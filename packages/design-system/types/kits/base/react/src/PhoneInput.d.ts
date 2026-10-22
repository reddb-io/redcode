import type { PhoneInputContract, PhoneCountry } from "../../src/core/contracts/phoneinput";
export interface PhoneInputProps extends PhoneInputContract {
    /** Additional classes on the field root. */
    className?: string;
    /** Reports unmasked international values after user edits and native form reset. */
    onValueChange?: (value: string) => void;
    /** Reports country changes from selection or an international paste. */
    onCountryChange?: (country: PhoneCountry) => void;
}
export declare function PhoneInput({ label, value, defaultValue, defaultCountry, countries, locale, name, form, id, help, error, required, disabled, presentation, sourceLabel, emptyLabel, placeholder, autoComplete, countryLabel, searchPlaceholder, emptyText, requiredMessage, invalidMessage, controlSize, className, onValueChange, onCountryChange }: PhoneInputProps): import("react").JSX.Element;
