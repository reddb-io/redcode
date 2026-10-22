import { AsYouType, getCountries, getCountryCallingCode, parseIncompletePhoneNumber } from "libphonenumber-js/min";
function phoneCountries(countries) {
  const supported = new Set(getCountries()), result = [...new Set(countries ?? getCountries())];
  if (!result.length || result.some((country) => !supported.has(country))) throw new RangeError("PhoneInput requires supported country codes and a non-empty country list.");
  return result;
}
function phoneFlag(country) {
  return [...country].map((letter) => String.fromCodePoint(127397 + letter.charCodeAt(0))).join("");
}
function phoneCountryName(country, locale = "en") {
  return new Intl.DisplayNames([locale], { type: "region" }).of(country) ?? country;
}
const optionCache = /* @__PURE__ */ new Map();
function phoneCountryOptions(countries, locale = "en", localized = true) {
  const key = `${localized ? locale : "iso"}:${countries.join(",")}`;
  const cached = optionCache.get(key);
  if (cached) return cached;
  const options = countries.map((country) => ({
    value: country,
    label: `${phoneFlag(country)} +${getCountryCallingCode(country)}`,
    description: localized ? phoneCountryName(country, locale) : country,
    keywords: [country, ...localized ? [phoneCountryName(country, "en")] : [], getCountryCallingCode(country)]
  }));
  options.sort((a, b) => localized ? a.description.localeCompare(b.description, locale) : a.value < b.value ? -1 : 1);
  optionCache.set(key, options);
  return options;
}
function phoneState(text, fallback) {
  const clean = parseIncompletePhoneNumber(text), international = clean.startsWith("+");
  if (!clean || clean === "+") return { country: fallback, display: clean, value: "", international: clean, possible: false };
  const formatter = new AsYouType(fallback), formatted = formatter.input(clean), number = formatter.getNumber();
  const country = formatter.getCountry() ?? fallback;
  const value = String(formatter.getNumberValue() ?? (international ? clean : `+${getCountryCallingCode(fallback)}${clean}`));
  const display = international && formatter.getCountry() && number ? number.formatNational() : formatted;
  const hasExtension = /(?:ext\.?|extension|[#x])\s*\d/i.test(text);
  return {
    country,
    display,
    value,
    international: number && formatter.getCountry() ? number.formatInternational() : new AsYouType().input(value),
    possible: Boolean(number?.isPossible() && formatter.getCountry() && value.length <= 16 && !hasExtension)
  };
}
function phoneProblem(state, countries, required, requiredMessage, invalidMessage) {
  return !state.value && !state.display ? required ? requiredMessage : "" : state.possible && countries.includes(state.country) ? "" : invalidMessage;
}
function phoneDigitCount(value) {
  return [...value.matchAll(/\p{Decimal_Number}/gu)].length;
}
function phoneCaret(display, digits) {
  if (!digits) return 0;
  for (let i = 0, count = 0; i < display.length; i++) if (/\p{Decimal_Number}/u.test(display[i]) && ++count >= digits) return i + 1;
  return display.length;
}
function phoneSeparatorDeletion(display, type, start, end) {
  if (start !== end || !["deleteContentBackward", "deleteContentForward"].includes(type)) return;
  const backward = type === "deleteContentBackward", character = display[backward ? start - 1 : start];
  if (!character || /\p{Decimal_Number}/u.test(character)) return;
  const digits = parseIncompletePhoneNumber(display).replace(/\D/g, ""), before = phoneDigitCount(display.slice(0, start));
  const index = backward ? before - 1 : before;
  if (index < 0 || index >= digits.length) return;
  return { text: digits.slice(0, index) + digits.slice(index + 1), digits: backward ? before - 1 : before };
}
function bindPhoneEditing(element, initial, changed) {
  let current = initial, composing = false;
  const blocked = () => element.matches(":disabled");
  function apply(text = element.value, digitPosition = phoneDigitCount(text.slice(0, element.selectionStart ?? text.length))) {
    if (blocked()) return;
    const next = phoneState(text, current.country), previous = current;
    current = next;
    element.value = next.display;
    const caret = phoneCaret(next.display, digitPosition);
    element.setSelectionRange(caret, caret);
    if (next.value !== previous.value || next.country !== previous.country || next.display !== previous.display) changed(next, previous);
  }
  function input(event) {
    if (!composing && !event.isComposing) apply();
  }
  function before(event) {
    if (composing || event.isComposing || blocked()) return;
    const deletion = phoneSeparatorDeletion(current.display, event.inputType, element.selectionStart ?? 0, element.selectionEnd ?? 0);
    if (deletion) {
      event.preventDefault();
      apply(deletion.text, deletion.digits);
    }
  }
  function compositionStart() {
    composing = true;
  }
  function compositionEnd() {
    composing = false;
    apply();
  }
  element.addEventListener("input", input);
  element.addEventListener("beforeinput", before);
  element.addEventListener("compositionstart", compositionStart);
  element.addEventListener("compositionend", compositionEnd);
  return {
    sync(next) {
      current = next;
      if (!composing && element.value !== next.display) element.value = next.display;
    },
    destroy() {
      element.removeEventListener("input", input);
      element.removeEventListener("beforeinput", before);
      element.removeEventListener("compositionstart", compositionStart);
      element.removeEventListener("compositionend", compositionEnd);
    }
  };
}
function phoneOptions(countries, country, locale, localized = true) {
  const options = phoneCountryOptions(countries, locale, localized);
  return countries.includes(country) ? options : [...options, { ...phoneCountryOptions([country], locale, localized)[0], disabled: true }];
}
function phoneInvalid(element) {
  const first = element.form ? [...element.form.elements].find((control) => "willValidate" in control && control.willValidate && !control.validity.valid) : element;
  if (first === element) element.focus();
}
export {
  bindPhoneEditing,
  phoneCaret,
  phoneCountries,
  phoneCountryName,
  phoneCountryOptions,
  phoneDigitCount,
  phoneFlag,
  phoneInvalid,
  phoneOptions,
  phoneProblem,
  phoneSeparatorDeletion,
  phoneState
};
