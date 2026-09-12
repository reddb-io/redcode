import { describe, expect, test } from "bun:test"
import { pluralCategory } from "@reddb-io/redcode-ui/context/i18n"
import { dict } from "./en"
import { designGoalPortuguese } from "./design-goal-br"
import {
  designGoalCoverage,
  designGoalDictionary,
  designGoalKeys,
  designGoalLocales,
  designGoalPluralLocale,
} from "./design-goal"
import { DESKTOP_NATIVE_LOCALES, DESKTOP_NATIVE_LOCALE_TAGS } from "./desktop-native"

describe("Design and Goal localization coverage", () => {
  test("declares English fallback separately from completed translations", () => {
    expect(designGoalLocales).toEqual(["en", "br"])
    expect(designGoalKeys).toHaveLength(152)
    expect(designGoalCoverage("en")).toEqual({ sourceLocale: "en", translated: [], fallback: [] })
    expect(designGoalCoverage("br")).toEqual({ sourceLocale: "br", translated: designGoalKeys, fallback: [] })
    for (const locale of DESKTOP_NATIVE_LOCALES.filter((locale) => locale !== "en" && locale !== "br")) {
      expect(designGoalCoverage(locale)).toEqual({ sourceLocale: "en", translated: [], fallback: designGoalKeys })
      for (const key of designGoalKeys) {
        expect(designGoalDictionary(locale)[key]).toBe(dict[key as keyof typeof dict])
      }
    }
  })

  test("Brazilian Portuguese supplies every new message and preserves placeholders", () => {
    for (const key of designGoalKeys) {
      expect(designGoalPortuguese[key]?.trim()).toBeTruthy()
      expect(placeholders(designGoalPortuguese[key])).toEqual(placeholders(dict[key as keyof typeof dict]))
    }
    expect(designGoalDictionary("br")["session.goal.turnLimit"]).not.toBe(dict["session.goal.turnLimit"])
    expect(designGoalDictionary("br")["session.design.studio.create"]).not.toBe(dict["session.design.studio.create"])
  })

  test("fallback count messages use the source language's plural rules", () => {
    expect(designGoalPluralLocale("fr", "session.goal.tokenCount")).toBe("en")
    expect(designGoalPluralLocale("sl", "session.goal.evidenceCount")).toBe("en")
    expect(designGoalPluralLocale("br", "session.goal.tokenCount")).toBe("br")
    expect(designGoalPluralLocale("fr", "session.question.pending")).toBe("fr")
    expect(pluralCategory(DESKTOP_NATIVE_LOCALE_TAGS[designGoalPluralLocale("fr", "session.goal.tokenCount")], 0)).toBe(
      "other",
    )
    expect(
      pluralCategory(DESKTOP_NATIVE_LOCALE_TAGS[designGoalPluralLocale("sl", "session.goal.evidenceCount")], 101),
    ).toBe("other")
    expect(designGoalDictionary("ar")["session.goal.evidenceCount.two"]).toBe("{{count}} evidence files")
    expect(placeholders(designGoalDictionary("br")["session.goal.evidenceCount.many"])).toEqual(["count"])
    expect(placeholders(designGoalDictionary("br")["session.goal.tokenCount.many"])).toEqual(["count"])
  })
})

function placeholders(value: string) {
  return [...value.matchAll(/{{\s*([^}]+?)\s*}}/g)].map((match) => match[1]).sort()
}
