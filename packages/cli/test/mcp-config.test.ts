import { expect, test } from "bun:test"
import path from "node:path"
import { parse } from "jsonc-parser"
import { isolatedEnv } from "./fixture/environment"
import { tmpdir } from "./fixture/tmpdir"

async function cli(directory: string, args: string[], env: Record<string, string | undefined> = {}) {
  const child = Bun.spawn(
    [
      process.execPath,
      "--tsconfig-override",
      path.join(import.meta.dir, "../tsconfig.json"),
      path.join(import.meta.dir, "../src/index.ts"),
      "mcp",
      ...args,
    ],
    {
      cwd: directory,
      env: isolatedEnv(directory, env),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { stdout, stderr, code }
}

test("the actual MCP CLI adds the exact local command and removes it without changing other settings or credentials", async () => {
  await using directory = await tmpdir()
  const file = path.join(directory.path, "redcode.jsonc")
  const credentials = path.join(directory.path, "saved-credentials.json")
  const text =
    '// keep this comment\n{"snapshots":false,"mcp":{"timeout":{"request":5000},"servers":{"other":{"type":"remote","url":"https://example.com/mcp"}}}}\n'
  await Bun.write(file, text)
  await Bun.write(credentials, '{"opaque":"saved credential fixture"}')
  const command = [
    "/home/joao.brizolla/.local/share/mise/installs/node/24.17.0/bin/playwright-mcp",
    "--cdp-endpoint",
    "http://localhost:9222",
    "--output-dir",
    "/tmp/with spaces",
    "--url",
    "not-a-redcode-option",
  ]
  const added = await cli(directory.path, ["add", "playwright", "--", ...command])
  expect({ code: added.code, stderr: added.stderr }).toEqual({ code: 0, stderr: "" })
  expect(parse(await Bun.file(file).text()).mcp.servers.playwright).toEqual({ type: "local", command })
  const removed = await cli(directory.path, ["remove", "playwright"])
  expect({ code: removed.code, stderr: removed.stderr }).toEqual({ code: 0, stderr: "" })
  expect(removed.stdout).toContain("Saved credentials were preserved")
  expect(parse(await Bun.file(file).text())).toEqual(parse(text))
  expect(await Bun.file(file).text()).toContain("keep this comment")
  expect(await Bun.file(credentials).text()).toBe('{"opaque":"saved credential fixture"}')
  expect(await Bun.file(path.join(directory.path, "opencode.json")).exists()).toBe(false)
}, 30_000)

test("MCP add follows Redcode config precedence and rm removes every authored project definition", async () => {
  await using directory = await tmpdir()
  expect(Bun.spawnSync(["git", "init", "--quiet", directory.path]).exitCode).toBe(0)
  const low = path.join(directory.path, "opencode.json")
  const high = path.join(directory.path, ".red", "code", "config.jsonc")
  const nested = path.join(directory.path, "src", "nested")
  await Bun.write(path.join(nested, ".keep"), "")
  await Bun.write(
    low,
    '{"mcp":{"playwright":{"type":"local","command":["broken"]},"other":{"type":"local","command":["keep"]}}}',
  )
  await Bun.write(
    high,
    '// preferred Redcode source\n{"mcp":{"servers":{"playwright":{"type":"local","command":["old"]}}}}',
  )
  const added = await cli(nested, ["add", "playwright", "--", "replacement", "--flag"])
  expect(added.code).toBe(0)
  expect(added.stdout).toContain(high)
  expect(parse(await Bun.file(high).text()).mcp.servers.playwright.command).toEqual(["replacement", "--flag"])
  expect(parse(await Bun.file(low).text()).mcp.playwright.command).toEqual(["broken"])
  const removed = await cli(nested, ["rm", "playwright"])
  expect(removed.code).toBe(0)
  expect(removed.stdout).toContain(low)
  expect(removed.stdout).toContain(high)
  expect(parse(await Bun.file(high).text()).mcp.servers).toEqual({})
  expect(parse(await Bun.file(low).text()).mcp).toEqual({ other: { type: "local", command: ["keep"] } })
  expect(await Bun.file(high).text()).toContain("preferred Redcode source")
}, 30_000)

test("MCP removal respects global and explicit scopes instead of deleting an inherited definition", async () => {
  await using directory = await tmpdir()
  const global = path.join(directory.path, "config", "config.jsonc")
  const explicit = path.join(directory.path, "custom.jsonc")
  const text = '{"mcp":{"servers":{"playwright":{"type":"remote","url":"https://example.com/mcp"}}}}'
  await Bun.write(global, text)
  const inherited = await cli(directory.path, ["remove", "playwright"])
  expect(inherited.code).toBe(1)
  expect(inherited.stdout + inherited.stderr).toContain("--global or --config")
  expect(await Bun.file(global).text()).toBe(text)
  await Bun.write(explicit, text)
  const selected = await cli(directory.path, ["remove", "playwright", "--config", explicit])
  expect(selected.code).toBe(0)
  expect(parse(await Bun.file(explicit).text()).mcp.servers).toEqual({})
  expect(await Bun.file(global).text()).toBe(text)
  const removed = await cli(directory.path, ["remove", "playwright", "--global"])
  expect(removed.code).toBe(0)
  expect(parse(await Bun.file(global).text()).mcp.servers).toEqual({})
}, 30_000)

test("MCP add creates the global Redcode config and preserves remote headers without launching a server", async () => {
  await using directory = await tmpdir()
  const added = await cli(directory.path, [
    "add",
    "company",
    "--global",
    "--url",
    "https://example.com/mcp",
    "--header",
    "Authorization=Bearer {env:COMPANY_MCP_TOKEN}",
  ])
  expect({ code: added.code, stderr: added.stderr }).toEqual({ code: 0, stderr: "" })
  const file = path.join(directory.path, "config", "config.jsonc")
  expect(parse(await Bun.file(file).text()).mcp.servers.company).toEqual({
    type: "remote",
    url: "https://example.com/mcp",
    headers: { Authorization: "Bearer {env:COMPANY_MCP_TOKEN}" },
  })
  expect(await Bun.file(path.join(directory.path, "redcode.jsonc")).exists()).toBe(false)
  expect(await Bun.file(path.join(directory.path, "config", "opencode.json")).exists()).toBe(false)
}, 30_000)

test("MCP add and remove work when Git is unavailable and keep their write scope in the current directory", async () => {
  await using directory = await tmpdir()
  const parent = path.join(directory.path, "redcode.jsonc")
  const nested = path.join(directory.path, "nested")
  const local = path.join(nested, "redcode.jsonc")
  const inherited = '{"mcp":{"servers":{"playwright":{"type":"local","command":["keep-parent"]}}}}'
  await Bun.write(parent, inherited)
  await Bun.write(path.join(nested, ".keep"), "")
  const env = { PATH: "", Path: undefined, path: undefined }
  const added = await cli(
    nested,
    ["add", "playwright", "--", "/opt/playwright-mcp", "--cdp-endpoint", "http://localhost:9222"],
    env,
  )
  expect({ code: added.code, stderr: added.stderr }).toEqual({ code: 0, stderr: "" })
  expect(parse(await Bun.file(local).text()).mcp.servers.playwright.command).toEqual([
    "/opt/playwright-mcp",
    "--cdp-endpoint",
    "http://localhost:9222",
  ])
  const removed = await cli(nested, ["remove", "playwright"], env)
  expect({ code: removed.code, stderr: removed.stderr }).toEqual({ code: 0, stderr: "" })
  expect(parse(await Bun.file(local).text()).mcp.servers).toEqual({})
  expect(await Bun.file(parent).text()).toBe(inherited)
}, 30_000)

test("project MCP authoring excludes the global config even when HOME is the current project", async () => {
  await using directory = await tmpdir()
  const root = path.join(directory.path, ".red", "code")
  const global = path.join(root, "config.jsonc")
  const project = path.join(directory.path, "redcode.jsonc")
  const text = '{"mcp":{"servers":{"playwright":{"type":"local","command":["keep-global"]}}}}'
  const env = { OPENCODE_CONFIG_DIR: root }
  await Bun.write(global, text)
  const inherited = await cli(directory.path, ["remove", "playwright"], env)
  expect(inherited.code).toBe(1)
  expect(await Bun.file(global).text()).toBe(text)
  const added = await cli(directory.path, ["add", "playwright", "--", "project-command"], env)
  expect(added.code).toBe(0)
  expect(parse(await Bun.file(project).text()).mcp.servers.playwright.command).toEqual(["project-command"])
  const removed = await cli(directory.path, ["remove", "playwright"], env)
  expect(removed.code).toBe(0)
  expect(parse(await Bun.file(project).text()).mcp.servers).toEqual({})
  const ambiguous = await cli(root, ["add", "playwright", "--", "ambiguous"], env)
  expect(ambiguous.code).toBe(1)
  expect(ambiguous.stdout + ambiguous.stderr).toContain("global configuration root")
  expect(await Bun.file(global).text()).toBe(text)
}, 30_000)

test("MCP authoring rejects malformed configuration and contradictory destinations without rewriting files", async () => {
  await using directory = await tmpdir()
  const file = path.join(directory.path, "redcode.jsonc")
  const text = '{"mcp":{"servers": [}}'
  await Bun.write(file, text)
  for (const args of [
    ["add", "playwright", "--", "do-not-execute"],
    ["remove", "playwright"],
  ]) {
    const result = await cli(directory.path, args)
    expect(result.code).toBe(1)
    expect(result.stdout + result.stderr).toContain("malformed configuration")
    expect(await Bun.file(file).text()).toBe(text)
  }
  const conflicting = await cli(directory.path, ["remove", "playwright", "--global", "--config", file])
  expect(conflicting.code).toBe(1)
  expect(conflicting.stdout + conflicting.stderr).toContain("Choose --global or --config")
}, 30_000)
