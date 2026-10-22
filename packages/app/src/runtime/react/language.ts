import type { useLanguage } from "@/runtime/i18n/language"

export function sharedLanguage(language: ReturnType<typeof useLanguage>) {
  return {
    locale: language.locale(),
    intl: language.intl(),
    // Track the asynchronously loaded dictionary in the Solid host as well as the selected locale.
    close: language.t("common.close"),
    t: language.t,
    rich: language.rich,
    tDynamic: language.tDynamic,
    plural: language.plural,
    list: (items: readonly string[]) => language.list(items).join(""),
  }
}

export type SharedLanguage = ReturnType<typeof sharedLanguage>
