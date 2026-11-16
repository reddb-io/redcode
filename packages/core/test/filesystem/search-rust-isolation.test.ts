import { describe, expect, test } from "bun:test"
import * as Contract from "../../src/filesystem/search-contract"
import * as Legacy from "../../src/filesystem/search"

describe("Rust filename search isolation", () => {
  test("shares the stable service contract with the legacy implementation", () => {
    expect(Contract.Service).toBe(Legacy.Service)
    expect(Contract.Options).toBe(Legacy.Options)
  })

  test("keeps the strict adapter free of legacy imports", async () => {
    const strict = await Bun.file(new URL("../../src/filesystem/search-native.bun.ts", import.meta.url)).text()
    const selector = await Bun.file(new URL("../../src/filesystem/search.ts", import.meta.url)).text()
    const contract = await Bun.file(new URL("../../src/filesystem/search-contract.ts", import.meta.url)).text()
    const fallback = await Bun.file(new URL("../../script/file-search-nucleo-fallback.ts", import.meta.url)).text()

    expect(strict).not.toContain('from "../src/filesystem/search"')
    expect(strict).not.toContain("fuzzysort")
    expect(strict).not.toContain("ripgrepLayer")
    expect(selector).toContain("NativePathSearch.tryNucleoAsyncRuntime")
    expect(contract).not.toContain("fuzzysort")
    expect(fallback).toContain('from "../src/filesystem/search"')
    expect(fallback).toContain("ripgrepLayer")
  })
})
