import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import fs from "node:fs/promises"
import path from "node:path"
import { VaultEnvFile } from "../src/vault/env-file.js"
import { tmpdir } from "./fixture/tmpdir"

// Assembled from parts so no secret scanner mistakes the fixture for a real credential.
const token = "ghp" + "_" + "a".repeat(36)

describe("VaultEnvFile text", () => {
  test("names the variable a reference stands for", () => {
    expect(VaultEnvFile.variable("github-token")).toBe("GITHUB_TOKEN")
    expect(VaultEnvFile.variable("github-token-2")).toBe("GITHUB_TOKEN_2")
    expect(VaultEnvFile.variable("1password")).toBe("SECRET_1PASSWORD")
  })

  test("writes a value as one line every dotenv reader gives back", () => {
    expect(VaultEnvFile.format(token)).toBe(token)
    expect(VaultEnvFile.format("two words")).toBe('"two words"')
    expect(VaultEnvFile.format("first\nsecond")).toBe('"first\\nsecond"')
    // `$` and backslashes are expanded inside double quotes by many readers, so they take single quotes.
    expect(VaultEnvFile.format("pa$$word")).toBe("'pa$$word'")
    expect(VaultEnvFile.format('say "hi"')).toBe(`'say "hi"'`)
    expect(VaultEnvFile.format(`it's "$x"`)).toBeUndefined()
    expect(VaultEnvFile.format("with\nbreak and $")).toBeUndefined()
    expect(VaultEnvFile.format("carriage\rreturn")).toBeUndefined()
    expect(VaultEnvFile.format("nul\0byte")).toBeUndefined()
    expect(VaultEnvFile.format("")).toBeUndefined()
  })

  test("appends a new variable, adding the line break a file may lack", () => {
    expect(VaultEnvFile.upsert("", "github-token", token)).toBe(`GITHUB_TOKEN=${token}\n`)
    expect(VaultEnvFile.upsert("PORT=3000", "github-token", token)).toBe(`PORT=3000\nGITHUB_TOKEN=${token}\n`)
    expect(VaultEnvFile.upsert("PORT=3000\r\n", "github-token", token)).toBe(`PORT=3000\r\nGITHUB_TOKEN=${token}\r\n`)
  })

  test("replaces the line that already sets the name and keeps everything else", () => {
    const text = ["# credentials", "PORT=3000", "export Github_Token = old", "", "LAST=1"].join("\n")
    expect(VaultEnvFile.upsert(text, "github-token", token)).toBe(
      ["# credentials", "PORT=3000", `export Github_Token=${token}`, "", "LAST=1"].join("\n"),
    )
  })

  test("declines a value it cannot write and a line that spans several", () => {
    expect(VaultEnvFile.upsert("", "github-token", `it's "$x"`)).toBeUndefined()
    expect(VaultEnvFile.upsert('KEY="first\nsecond"\n', "key", "new-value")).toBeUndefined()
    expect(VaultEnvFile.upsert("KEY='first\nsecond'\n", "other", "new-value")).toBe(
      "KEY='first\nsecond'\nOTHER=new-value\n",
    )
  })

  test("removes only the line that sets the name", () => {
    expect(VaultEnvFile.remove(`A=1\nGITHUB_TOKEN=${token}\nB=2\n`, "github-token")).toBe("A=1\nB=2\n")
    expect(VaultEnvFile.remove("A=1\r\nGITHUB_TOKEN=x\r\n", "github-token")).toBe("A=1\r\n")
    expect(VaultEnvFile.remove("A=1\n", "github-token")).toBe("A=1\n")
  })

  test("adds .env to a gitignore that lacks it", () => {
    expect(VaultEnvFile.ignored("")).toBe(".env\n")
    expect(VaultEnvFile.ignored("node_modules")).toBe("node_modules\n.env\n")
    expect(VaultEnvFile.ignored("node_modules\n.env\n")).toBeUndefined()
    expect(VaultEnvFile.ignored("/.env\n")).toBeUndefined()
    expect(VaultEnvFile.ignored("  .env*  \n")).toBeUndefined()
    expect(VaultEnvFile.ignored(".env.example\n")).toBe(".env.example\n.env\n")
  })
})

describe("VaultEnvFile root", () => {
  test("is the nearest ancestor with a .git directory", async () => {
    await using tmp = await tmpdir()
    await fs.mkdir(path.join(tmp.path, ".git"))
    await fs.mkdir(path.join(tmp.path, "packages", "app"), { recursive: true })
    expect(await VaultEnvFile.root(path.join(tmp.path, "packages", "app"))).toBe(tmp.path)
  })

  test("is the main checkout for a linked worktree", async () => {
    await using tmp = await tmpdir()
    const main = path.join(tmp.path, "main")
    const linked = path.join(tmp.path, "linked")
    await fs.mkdir(path.join(main, ".git", "worktrees", "linked"), { recursive: true })
    await fs.mkdir(linked)
    await Bun.write(path.join(linked, ".git"), `gitdir: ${path.join(main, ".git", "worktrees", "linked")}\n`)
    expect(await VaultEnvFile.root(linked)).toBe(main)
  })

  test("is the worktree itself when its .git file names no worktree directory", async () => {
    await using tmp = await tmpdir()
    await Bun.write(path.join(tmp.path, ".git"), "gitdir: /somewhere/else\n")
    expect(await VaultEnvFile.root(tmp.path)).toBe(tmp.path)
    await Bun.write(path.join(tmp.path, ".git"), "not a pointer\n")
    expect(await VaultEnvFile.root(tmp.path)).toBe(tmp.path)
  })

  test("is the directory itself outside a repository", async () => {
    await using tmp = await tmpdir()
    expect(await VaultEnvFile.root(tmp.path)).toBe(tmp.path)
  })
})

describe("VaultEnvFile store", () => {
  test("creates a private .env at the repository root and ignores it", async () => {
    await using tmp = await tmpdir()
    await fs.mkdir(path.join(tmp.path, ".git"))
    await fs.mkdir(path.join(tmp.path, "src"))
    const store = VaultEnvFile.store()
    const written = await Effect.runPromise(
      store.update(path.join(tmp.path, "src"), (text) => VaultEnvFile.upsert(text, "github-token", token)),
    )
    expect(written).toBe(true)
    expect(await Bun.file(path.join(tmp.path, ".env")).text()).toBe(`GITHUB_TOKEN=${token}\n`)
    expect(await Bun.file(path.join(tmp.path, ".gitignore")).text()).toBe(".env\n")
    if (process.platform !== "win32") expect((await fs.stat(path.join(tmp.path, ".env"))).mode & 0o777).toBe(0o600)
    expect(await Effect.runPromise(store.read(tmp.path))).toBe(`GITHUB_TOKEN=${token}\n`)
  })

  test("keeps an existing file's mode and the rest of its .gitignore", async () => {
    await using tmp = await tmpdir()
    await fs.mkdir(path.join(tmp.path, ".git"))
    await Bun.write(path.join(tmp.path, ".gitignore"), "dist\n")
    await Bun.write(path.join(tmp.path, ".env"), "PORT=3000\n")
    if (process.platform !== "win32") await fs.chmod(path.join(tmp.path, ".env"), 0o640)
    await Effect.runPromise(
      VaultEnvFile.store().update(tmp.path, (text) => VaultEnvFile.upsert(text, "github-token", token)),
    )
    expect(await Bun.file(path.join(tmp.path, ".env")).text()).toBe(`PORT=3000\nGITHUB_TOKEN=${token}\n`)
    expect(await Bun.file(path.join(tmp.path, ".gitignore")).text()).toBe("dist\n.env\n")
    if (process.platform !== "win32") expect((await fs.stat(path.join(tmp.path, ".env"))).mode & 0o777).toBe(0o640)
  })

  test("leaves .gitignore alone outside a repository and when nothing changes", async () => {
    await using tmp = await tmpdir()
    const store = VaultEnvFile.store()
    expect(await Effect.runPromise(store.update(tmp.path, (text) => text + "A=1\n"))).toBe(true)
    expect(await Bun.file(path.join(tmp.path, ".gitignore")).exists()).toBe(false)
    expect(await Effect.runPromise(store.update(tmp.path, (text) => text))).toBe(true)
    expect(await Effect.runPromise(store.update(tmp.path, () => undefined))).toBe(false)
    expect(await Bun.file(path.join(tmp.path, ".env")).text()).toBe("A=1\n")
  })

  test("reads nothing from a directory without a file, and reports a refused write", async () => {
    await using tmp = await tmpdir()
    const store = VaultEnvFile.store()
    expect(await Effect.runPromise(store.read(tmp.path))).toBeUndefined()
    const missing = path.join(tmp.path, "missing")
    expect(await Effect.runPromise(store.update(missing, () => "A=1\n"))).toBe(false)
  })
})
