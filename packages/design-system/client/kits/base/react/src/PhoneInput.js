"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Field } from "./Field.js";
import { SearchSelect } from "./SearchSelect.js";
import { useValue } from "./state.js";
import { input as inputStyle } from "../../src/input.variants.js";
import { phoneInput } from "../../src/phone-input.variants.js";
import { bindPhoneEditing, phoneCountries, phoneCountryName, phoneFlag, phoneInvalid, phoneOptions, phoneProblem, phoneState } from "../../src/core/phone-input.js";
import { afterFormReset, associatedForm } from "../../src/core/native-controls.js";
function PhoneInput({
  label,
  value,
  defaultValue = "",
  defaultCountry = "US",
  countries,
  locale = "en",
  name,
  form,
  id,
  help,
  error,
  required = false,
  disabled = false,
  presentation = "input",
  sourceLabel,
  emptyLabel = "No phone number",
  placeholder,
  autoComplete = "tel-national",
  countryLabel = "Country",
  searchPlaceholder = "Search countries",
  emptyText = "No matching countries",
  requiredMessage = "Enter a phone number.",
  invalidMessage = "Enter a complete phone number for an allowed country.",
  controlSize = "md",
  className,
  onValueChange,
  onCountryChange
}) {
  const [localized, setLocalized] = useState(false);
  useEffect(() => setLocalized(true), []);
  const allowed = phoneCountries(countries);
  const initial = useRef(phoneState(value ?? defaultValue, allowed.includes(defaultCountry) ? defaultCountry : allowed[0]));
  const [currentValue, setValue] = useValue(value, initial.current.value, onValueChange);
  const [draft, setDraft] = useState(initial.current), [invalid, setInvalid] = useState(false);
  const current = currentValue === draft.value ? draft : phoneState(currentValue, draft.country);
  const problem = phoneProblem(current, allowed, required, requiredMessage, invalidMessage);
  const element = useRef(null), hidden = useRef(null);
  const editing = useRef(void 0);
  const latest = useRef({ current, setValue, onCountryChange });
  latest.current = { current, setValue, onCountryChange };
  const slots = phoneInput(), uid = useId(), options = phoneOptions(allowed, current.country, locale, localized);
  function change(next, previous = latest.current.current) {
    setDraft(next);
    if (next.value !== previous.value) latest.current.setValue(next.value);
    if (next.country !== previous.country) latest.current.onCountryChange?.(next.country);
  }
  useLayoutEffect(() => {
    if (!element.current) return;
    const binding = bindPhoneEditing(element.current, latest.current.current, change);
    editing.current = binding;
    return () => {
      binding.destroy();
      if (editing.current === binding) editing.current = void 0;
    };
  }, [presentation]);
  useLayoutEffect(() => {
    editing.current?.sync(current);
    element.current?.setCustomValidity(problem);
  });
  useEffect(() => afterFormReset(associatedForm(hidden.current, form), () => {
    const previous = latest.current.current;
    setDraft({ ...initial.current });
    latest.current.setValue(initial.current.value);
    setInvalid(false);
    if (previous.country !== initial.current.country) latest.current.onCountryChange?.(initial.current.country);
  }), [form]);
  return /* @__PURE__ */ jsxs("div", { "data-phone-input": true, "data-presentation": presentation, className: slots.root({ class: className }), children: [
    /* @__PURE__ */ jsx("input", { ref: hidden, type: "hidden", name, form, value: current.value, disabled }),
    presentation === "text" ? /* @__PURE__ */ jsxs("div", { role: "group", "aria-labelledby": `${uid}-label`, className: slots.read(), children: [
      /* @__PURE__ */ jsx("span", { id: `${uid}-label`, className: slots.label(), children: label }),
      /* @__PURE__ */ jsxs("span", { "data-phone-value": true, className: slots.value(), children: [
        current.value && /* @__PURE__ */ jsx("span", { "aria-hidden": "true", className: slots.flag(), children: phoneFlag(current.country) }),
        /* @__PURE__ */ jsx("span", { className: slots.number(), children: current.international || emptyLabel })
      ] }),
      sourceLabel && /* @__PURE__ */ jsx("span", { className: slots.help(), children: sourceLabel }),
      help && /* @__PURE__ */ jsx("span", { className: slots.help(), children: help }),
      error && /* @__PURE__ */ jsx("span", { role: "alert", className: slots.error(), children: error })
    ] }) : /* @__PURE__ */ jsx(Field, { label, help, error: error || (invalid ? problem : void 0), required, id, children: (control) => /* @__PURE__ */ jsxs("div", { className: slots.row(), children: [
      /* @__PURE__ */ jsx(
        SearchSelect,
        {
          label: `${countryLabel}: ${localized ? phoneCountryName(current.country, locale) : current.country}`,
          options,
          value: current.country,
          onValueChange: (country) => {
            if (!allowed.includes(country) || element.current?.matches(":disabled")) return;
            change(phoneState(current.display, country));
            element.current?.focus();
          },
          clearable: false,
          disabled,
          controlSize,
          searchPlaceholder,
          emptyText,
          className: slots.country(),
          contentClass: slots.popup()
        }
      ),
      /* @__PURE__ */ jsx(
        "input",
        {
          ...control,
          ref: element,
          type: "tel",
          inputMode: "tel",
          autoComplete,
          form,
          disabled,
          placeholder,
          defaultValue: initial.current.display,
          className: inputStyle({ size: controlSize, class: slots.input() }),
          onBlur: () => setInvalid(true),
          onInvalid: (event) => {
            event.preventDefault();
            setInvalid(true);
            phoneInvalid(event.currentTarget);
          }
        }
      )
    ] }) })
  ] });
}
export {
  PhoneInput
};
