import { reviewCopy } from "@reddb-io/redcode-design/copy"
import { dict } from "./en"
import { designGoalPortuguese } from "./design-goal-br"
import { desktopNativePluralCategories, type DesktopNativeLocale } from "./desktop-native"

// These domains currently ship in English and Brazilian Portuguese. Other locales use the
// existing English fallback deliberately; dictionary parity does not claim translation coverage.
export const designGoalLocales = ["en", "br"] as const
export const designGoalKeys = [
  ...Object.keys(reviewCopy).map((key) => `session.design.studio.${key}`),
  "session.goal.providerBudget",
  "session.goal.turnLimit",
  "session.goal.executePlan",
  "session.goal.evidenceCount.one",
  "session.goal.evidenceCount.other",
  "session.goal.tokenCount.one",
  "session.goal.tokenCount.other",
  "session.goal.evidence",
  "session.goal.checks",
  "session.goal.plans",
  "session.goal.plan.ready",
  "session.goal.plan.approved",
  "session.goal.extend",
  "session.goal.error",
  "session.goal.state.active",
  "session.goal.state.waiting",
  "session.goal.state.paused",
  "session.goal.state.blocked",
  "session.goal.state.done",
]

const english = Object.fromEntries(Object.entries(dict).filter(([key]) => designGoalKeys.includes(key)))
const plurals = ["session.goal.evidenceCount", "session.goal.tokenCount"]

export function designGoalSourceLocale(locale: DesktopNativeLocale) {
  return locale === "br" ? "br" : "en"
}

export function designGoalCoverage(locale: DesktopNativeLocale) {
  return {
    sourceLocale: designGoalSourceLocale(locale),
    translated: locale === "br" ? designGoalKeys : [],
    fallback: locale === "en" || locale === "br" ? [] : designGoalKeys,
  }
}

export function designGoalDictionary(locale: DesktopNativeLocale): Record<string, string> {
  const source = locale === "br" ? designGoalPortuguese : english
  return {
    ...source,
    ...Object.fromEntries(
      plurals.flatMap((key) =>
        desktopNativePluralCategories(locale).map((category) => [
          `${key}.${category}`,
          source[`${key}.${category}`] ?? source[`${key}.other`],
        ]),
      ),
    ),
  }
}

// English fallback copy must use English grammar even when the selected locale has different
// cardinal rules (for example French zero or Slovenian 101).
export function designGoalPluralLocale(locale: DesktopNativeLocale, key: string) {
  return plurals.includes(key) ? designGoalSourceLocale(locale) : locale
}
