import { expect, test } from "bun:test"
import { permissionAlwaysLines, permissionPresentation } from "../../src/util/permission"

test("preserves permission roots and self-contained metadata", () => {
  expect(permissionPresentation({ action: "external_directory", resources: ["/*"] }).title).toBe(
    "Access external directory /",
  )
  expect(permissionPresentation({ action: "external_directory", resources: ["C:/*"] }).title).toBe(
    "Access external directory C:/",
  )
  expect(
    permissionPresentation({ action: "webfetch", resources: [], metadata: { url: "https://example.com" } }),
  ).toMatchObject({
    title: "WebFetch https://example.com",
    lines: ["URL: https://example.com"],
  })
  expect(permissionPresentation({ action: "websearch", resources: [], metadata: { query: "releases" } })).toMatchObject(
    {
      title: 'Web Search "releases"',
      lines: ["Query: releases"],
    },
  )
})

test("presents a vault send without any value and names every destination", () => {
  expect(
    permissionPresentation({
      action: "vault",
      resources: ["github-token@api.github.com"],
      metadata: { secrets: ["github-token"], destinations: ["api.github.com"], command: "curl https://api.github.com" },
    }),
  ).toEqual({
    icon: "⚿",
    title: "Allow {vault:github-token} to be sent to api.github.com?",
    lines: ["Command: curl https://api.github.com", "The value itself is never shown to the model."],
  })
  expect(
    permissionPresentation({
      action: "vault",
      resources: ["db-password@cmd:psql", "api-key@file:.env"],
      metadata: { secrets: ["db-password", "api-key"], destinations: ["cmd:psql", "file:.env"], file: ".env" },
    }),
  ).toMatchObject({
    title: "Allow {vault:db-password}, {vault:api-key} to be sent to the psql command, the file .env?",
    lines: ["File: .env", "The value itself is never shown to the model."],
  })
  expect(permissionPresentation({ action: "vault", resources: ["api-key@mcp:tracker"] }).title).toBe(
    "Allow {vault:api-key} to be sent to the MCP server tracker?",
  )
})

test("always-allow lines for a vault send name each secret and destination pair", () => {
  expect(
    permissionAlwaysLines({ action: "vault", save: ["github-token@api.github.com", "db-password@cmd:psql"] }),
  ).toEqual([
    "This will always allow {vault:github-token} to be sent to api.github.com while the vault holds it.",
    "This will always allow {vault:db-password} to be sent to the psql command while the vault holds it.",
  ])
  expect(permissionAlwaysLines({ action: "vault", save: ["api-key@user@host.example"] })).toEqual([
    "This will always allow {vault:api-key} to be sent to user@host.example while the vault holds it.",
  ])
})
