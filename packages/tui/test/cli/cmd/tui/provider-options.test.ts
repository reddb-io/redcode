import { describe, expect, test } from "bun:test"
import { providerOptions } from "../../../../src/component/dialog-provider"

describe("providerOptions", () => {
  test("offers OpenAI-compatible right after the popular providers", () => {
    const options = providerOptions([
      { id: "openai", name: "OpenAI" },
      { id: "anthropic", name: "Anthropic" },
      { id: "mistral", name: "Mistral" },
    ])
    expect(options.map((option) => option.value)).toEqual([
      "openai",
      "anthropic",
      "__openai_compatible_provider__",
      "9router",
      "mistral",
      "red-router",
    ])
    expect(options[2]).toMatchObject({
      type: "compatible",
      title: "OpenAI-compatible",
      category: "Popular",
    })
    expect(options[2].description).toContain("custom base URL and API key")
  })

  test("no longer offers the credential-only Other entry", () => {
    expect(providerOptions([]).some((option) => option.title === "Other")).toBe(false)
  })

  test("does not use Other as the generic provider category", () => {
    expect(
      providerOptions([{ id: "mistral", name: "Mistral" }]).find((option) => option.value === "mistral")?.category,
    ).toBe("Providers")
  })

  test("keeps popular providers first and sorts the rest alphabetically", () => {
    expect(
      providerOptions([
        { id: "openai", name: "OpenAI" },
        { id: "custom-z", name: "Zebra Provider" },
        { id: "anthropic", name: "Anthropic" },
        { id: "mistral", name: "Mistral" },
        { id: "aws", name: "AWS Bedrock" },
      ]).map((option) => option.value),
    ).toEqual([
      "openai",
      "anthropic",
      "__openai_compatible_provider__",
      "9router",
      "aws",
      "mistral",
      "red-router",
      "custom-z",
    ])
  })

  test("offers 9Router before configuration without duplicating a configured provider", () => {
    expect(providerOptions([]).find((option) => option.value === "9router")?.title).toBe("9Router")
    const options = providerOptions([{ id: "9router", name: "My Router" }]).filter(
      (option) => option.value === "9router",
    )
    expect(options).toHaveLength(1)
    expect(options[0].title).toBe("My Router")
  })

  test("hides 9Router when disabled_providers contains it", () => {
    expect(providerOptions([], ["9router"]).some((option) => option.value === "9router")).toBe(false)
  })

  test("offers RedRouter without duplicates and respects disabled providers", () => {
    expect(providerOptions([]).find((option) => option.value === "red-router")?.title).toBe("RedRouter")
    const options = providerOptions([{ id: "red-router", name: "My RedRouter" }]).filter(
      (option) => option.value === "red-router",
    )
    expect(options).toHaveLength(1)
    expect(options[0].title).toBe("My RedRouter")
    expect(providerOptions([], ["red-router"]).some((option) => option.value === "red-router")).toBe(false)
  })

  test("does not collide with a configured provider named other", () => {
    const values = providerOptions([{ id: "other", name: "Other Provider" }]).map((option) => option.value)
    expect(new Set(values).size).toBe(values.length)
  })
})
