import { expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ModelsSources } from "../src/models-sources"

test("reads models.sources from JSONC and ignores other shapes", () => {
  expect(
    ModelsSources.fromText(`{ // mirror\n "models": { "sources": ["https://mirror.example/api.json", 3,] } }`),
  ).toEqual(["https://mirror.example/api.json"])
  expect(ModelsSources.fromText(`{ "models": { "sources": "https://mirror.example" } }`)).toBeUndefined()
  expect(ModelsSources.fromText(`{ "model": "a/b" }`)).toBeUndefined()
  expect(ModelsSources.fromText("{ broken")).toBeUndefined()
  expect(ModelsSources.fromText(undefined)).toBeUndefined()
})

test("the last global config that sets the list wins", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "redcode-models-sources-"))
  await writeFile(path.join(directory, "opencode.json"), `{ "models": { "sources": ["https://a.example"] } }`)
  await writeFile(path.join(directory, "config.jsonc"), `{ "models": { "sources": ["https://b.example"] } }`)
  expect(await ModelsSources.read({ directory })).toEqual(["https://b.example"])
  expect(
    await ModelsSources.read({ directory, content: `{ "models": { "sources": ["https://c.example"] } }` }),
  ).toEqual(["https://c.example"])
  expect(await ModelsSources.read({ directory: path.join(directory, "missing") })).toBeUndefined()
  await rm(directory, { recursive: true, force: true })
})
