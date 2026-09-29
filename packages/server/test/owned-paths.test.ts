import { describe, expect, test } from "bun:test"
import { LegacyRpcApi } from "@opencode/protocol/groups/legacy-rpc"
import { HttpApi } from "effect/unstable/httpapi"
import path from "node:path"
import { Api } from "../src/api"
import { OwnedPaths } from "../src/owned-paths"

describe("OwnedPaths.owned", () => {
  test("claims each root and everything under it", () => {
    expect(
      ["/api", "/api/info", "/auth/connect/code", "/openapi.json", "/rpc", "/design/session/ses_1/review"].filter(
        (pathname) => !OwnedPaths.owned(pathname),
      ),
    ).toEqual([])
  })

  test("leaves the web app's pages and assets, and look-alike paths, to the web app", () => {
    expect(
      [
        "/",
        "/settings",
        "/new-session",
        "/server/local/session/ses_1",
        "/_assets/app.js",
        "/icons/icon.svg",
        "/sw.js",
        "/apis",
        "/rpc.js",
        "/designer",
        "/openapi.json.map",
      ].filter((pathname) => OwnedPaths.owned(pathname)),
    ).toEqual([])
  })

  test("covers every HttpApi endpoint the server builds", () => {
    const paths: string[] = []
    const collect = {
      onGroup() {},
      onEndpoint(input: { readonly endpoint: { readonly path: string } }) {
        paths.push(input.endpoint.path)
      },
    }
    HttpApi.reflect(Api, collect)
    HttpApi.reflect(LegacyRpcApi, collect)
    expect(paths).toContain("/rpc")
    expect(paths.filter((pathname) => !OwnedPaths.owned(pathname))).toEqual([])
  })

  // The router cannot list its routes, so the raw registrations are read from the server's source.
  test("covers every raw route the server registers", async () => {
    const directory = path.join(import.meta.dir, "..", "src")
    const files = await Array.fromAsync(new Bun.Glob("**/*.ts").scan({ cwd: directory }))
    const sources = await Promise.all(files.map((file) => Bun.file(path.join(directory, file)).text()))
    const registration = /\b(?:router|HttpRouter)\.(?:add|route)\(\s*"[^"]*"\s*,\s*"([^"]+)"/g
    const paths = sources.flatMap((source) => Array.from(source.matchAll(registration), (match) => match[1]))
    expect(paths).toContain("/design/session/:sessionID/*")
    expect(paths.filter((pathname) => !OwnedPaths.owned(pathname))).toEqual([])
  })
})
