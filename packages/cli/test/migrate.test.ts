import path from "node:path"
import { expect, test } from "bun:test"
import { FileConversion } from "../src/migration/file"
import { tmpdir } from "./fixture/tmpdir"

test("explicit configuration conversion preserves the source and publishes only a valid new file", async () => {
  await using directory = await tmpdir()
  const source = path.join(directory.path, "old.jsonc")
  const output = path.join(directory.path, "current.json")
  const text = '// source comment\n{"snapshot":false,"agent":{"reviewer":{"prompt":"Review"}}}\n'
  await Bun.write(source, text)
  expect(await FileConversion.inspect(source)).toMatchObject({ current: false, compatible: true, kind: "config" })
  expect(await Bun.file(output).exists()).toBe(false)
  await FileConversion.convert(source, output)
  expect(await Bun.file(output).json()).toMatchObject({ snapshots: false, agents: { reviewer: { system: "Review" } } })
  expect(await Bun.file(source).text()).toBe(text)
  expect(await FileConversion.inspect(output)).toMatchObject({ current: true, compatible: true })
  await expect(FileConversion.convert(source, output)).rejects.toThrow()
  await expect(FileConversion.convert(source, source)).rejects.toThrow("different files")
  expect(await Bun.file(source).text()).toBe(text)
})

test("incompatible conversion cannot silently discard fields or write an output", async () => {
  await using directory = await tmpdir()
  for (const value of [{ snapshot: "yes" }, { layout: {} }, null]) {
    const source = path.join(directory.path, "old.json")
    const output = path.join(directory.path, "current.json")
    await Bun.write(source, JSON.stringify(value))
    expect((await FileConversion.inspect(source)).compatible).toBe(false)
    await expect(FileConversion.convert(source, output)).rejects.toThrow("incompatibilities")
    expect(await Bun.file(output).exists()).toBe(false)
  }
})

test("the actual migrate CLI inspects without printing credential values or starting a server", async () => {
  await using directory = await tmpdir()
  const source = path.join(directory.path, "old.json")
  const output = path.join(directory.path, "current.json")
  await Bun.write(source, JSON.stringify({ snapshot: false, username: "private-user-value" }))
  const run = async (args: string[]) => {
    const child = Bun.spawn([process.execPath, path.join(import.meta.dir, "../src/index.ts"), "migrate", ...args], {
      cwd: path.join(import.meta.dir, ".."),
      env: {
        ...process.env,
        OPENCODE_TEST_HOME: directory.path,
        XDG_CONFIG_HOME: directory.path,
        OPENCODE_CONFIG: undefined,
        OPENCODE_CONFIG_CONTENT: undefined,
      },
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    expect({ code, stderr }).toMatchObject({ code: 0 })
    expect(stdout + stderr).not.toContain("private-user-value")
    return JSON.parse(stdout)
  }
  expect(await run(["inspect", source, "--kind", "config", "--json"])).toMatchObject({
    compatible: true,
    current: false,
  })
  expect(await Bun.file(output).exists()).toBe(false)
  expect(await run(["convert", source, "--kind", "config", "--output", output])).toMatchObject({
    output,
    kind: "config",
  })
  expect(await Bun.file(output).json()).toMatchObject({ snapshots: false })
}, 30_000)

test("explicit display conversion preserves an old toggle and refuses implicit conversion in the runtime", async () => {
  await using directory = await tmpdir()
  const source = path.join(directory.path, "cli.json")
  const output = path.join(directory.path, "converted.json")
  const text = '{"tabs":{"enabled":false},"animations":false}'
  await Bun.write(source, text)
  expect(await FileConversion.inspect(source, "display")).toMatchObject({ current: false, compatible: true })
  await FileConversion.convert(source, output, "display")
  expect(await Bun.file(source).text()).toBe(text)
  expect(await Bun.file(output).json()).toMatchObject({ tabs: { mode: "off" }, animations: false })
  expect((await Bun.file(output).json()).tabs).not.toHaveProperty("enabled")
})

test("explicit theme conversion produces a valid document with light, dark and custom fallback resolution", async () => {
  await using directory = await tmpdir()
  const source = path.join(directory.path, "theme.json")
  const output = path.join(directory.path, "converted.json")
  const text = await Bun.file(path.join(import.meta.dir, "../../theme/test/fixture/legacy-themes/github.json")).text()
  await Bun.write(source, text)
  expect(await FileConversion.inspect(source, "theme")).toMatchObject({ current: false, compatible: true })
  await FileConversion.convert(source, output, "theme")
  expect(await Bun.file(source).text()).toBe(text)
  expect(await FileConversion.inspect(output, "theme")).toMatchObject({ current: true, compatible: true })
  const { parseThemeDocument, resolveThemeDocument } = await import("@opencode/theme/tui")
  const document = parseThemeDocument(await Bun.file(output).json())
  for (const mode of ["light", "dark"] as const) expect(resolveThemeDocument(document, mode).text.base).toBeDefined()
})

test("history conversion reads a consistent WAL snapshot and keeps its source database unchanged", async () => {
  await using directory = await tmpdir()
  const filename = path.join(directory.path, "redcode.db")
  const output = path.join(directory.path, "converted.db")
  const { Database } = await import("bun:sqlite")
  using source = new Database(filename)
  source.run("PRAGMA journal_mode=WAL")
  source.run("PRAGMA wal_autocheckpoint=0")
  source.run(`
      CREATE TABLE project (
        id text PRIMARY KEY, worktree text NOT NULL, vcs text, name text, icon_url text, icon_url_override text,
        icon_color text, time_created integer NOT NULL, time_updated integer NOT NULL, time_initialized integer,
        sandboxes text NOT NULL, commands text
      );
      CREATE TABLE session (
        id text PRIMARY KEY, project_id text NOT NULL, workspace_id text, parent_id text, fork_session_id text,
        fork_boundary text, slug text NOT NULL, directory text NOT NULL, path text, title text, version text NOT NULL,
        share_url text, summary_additions integer, summary_deletions integer, summary_files integer, summary_diffs text,
        metadata text, cost real DEFAULT 0 NOT NULL, tokens_input integer DEFAULT 0 NOT NULL,
        tokens_output integer DEFAULT 0 NOT NULL, tokens_reasoning integer DEFAULT 0 NOT NULL,
        tokens_cache_read integer DEFAULT 0 NOT NULL, tokens_cache_write integer DEFAULT 0 NOT NULL, revert text,
        permission text, agent text, model text, time_created integer NOT NULL, time_updated integer NOT NULL,
        time_compacting integer, time_archived integer, time_suspended integer
      );
      CREATE TABLE session_message (
        id text PRIMARY KEY, session_id text NOT NULL, type text NOT NULL, seq integer NOT NULL,
        time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL
      );
      CREATE TABLE message (id text PRIMARY KEY, session_id text NOT NULL, time_created integer, time_updated integer, data text);
      CREATE TABLE part (id text PRIMARY KEY, message_id text, session_id text, time_created integer, time_updated integer, data text);
      CREATE TABLE project_directory (
        project_id text NOT NULL, directory text NOT NULL, type text, strategy text, time_created integer NOT NULL,
        PRIMARY KEY (project_id, directory)
      );
      CREATE TABLE session_context_epoch (
        session_id text PRIMARY KEY, baseline text NOT NULL, snapshot text NOT NULL,
        baseline_seq integer NOT NULL, replacement_seq integer
      );
      INSERT INTO project VALUES ('red-project', '/tmp/redcode', 'git', NULL, NULL, NULL, NULL, 1, 2, NULL, '[]', NULL);
      INSERT INTO project_directory VALUES
        ('red-project', '/tmp/redcode', 'main', NULL, 1),
        ('red-project', '/tmp/git-child', 'git_worktree', NULL, 2),
        ('red-project', '/tmp/custom-child', NULL, 'acme/snapshot', 3);
      INSERT INTO session (id, project_id, slug, directory, version, time_created, time_updated)
        VALUES
          ('ses_redcode_epoch', 'red-project', 'legacy', '/tmp/redcode', '1', 1, 2),
          ('ses_redcode_requested_epoch', 'red-project', 'legacy', '/tmp/redcode', '1', 1, 2);
      INSERT INTO session_message VALUES
        ('msg_redcode_compaction', 'ses_redcode_epoch', 'compaction', 4, 2, 2, '{}'),
        ('msg_redcode_requested_compaction', 'ses_redcode_requested_epoch', 'compaction', 4, 2, 2, '{}');
      INSERT INTO session_context_epoch VALUES
        ('ses_redcode_epoch', 'Old baseline', '{}', 2, NULL),
        ('ses_redcode_requested_epoch', 'Requested baseline', '{}', 2, 3);
  `)
  const original = await Bun.file(filename).arrayBuffer()
  const wal = await Bun.file(filename + "-wal").arrayBuffer()
  expect(await FileConversion.inspect(filename, "history")).toMatchObject({ compatible: true, current: false })
  await FileConversion.convert(filename, output, "history")
  expect(await Bun.file(filename).arrayBuffer()).toEqual(original)
  expect(await Bun.file(filename + "-wal").arrayBuffer()).toEqual(wal)
  using converted = new Database(output, { readonly: true })
  expect(converted.query<{ id: string }, []>("SELECT id FROM session_v2 ORDER BY id").all()).toEqual([
    { id: "ses_redcode_epoch" },
    { id: "ses_redcode_requested_epoch" },
  ])
  expect(converted.query("PRAGMA quick_check").get()).toEqual({ quick_check: "ok" })
  await expect(FileConversion.convert(filename, output, "history")).rejects.toThrow()
})

test("display inspection recognizes current documents independently of key order and rejects unsupported values", async () => {
  await using directory = await tmpdir()
  const source = path.join(directory.path, "cli.json")
  const output = path.join(directory.path, "converted.json")
  await Bun.write(source, '{"animations":false,"tabs":{"mode":"off"},"mouse":true}')
  expect(await FileConversion.inspect(source, "display")).toMatchObject({ current: true, compatible: true })
  for (const value of [{ tabs: { enabled: "false" } }, { tabs: { mode: "off", unknown: true } }, { unknown: true }]) {
    await Bun.write(source, JSON.stringify(value))
    expect(await FileConversion.inspect(source, "display")).toMatchObject({ current: false, compatible: false })
    await expect(FileConversion.convert(source, output, "display")).rejects.toThrow("incompatibilities")
    expect(await Bun.file(output).exists()).toBe(false)
  }
})

test("explicit display import keeps native key binding choices over historical names", async () => {
  await using directory = await tmpdir()
  const source = path.join(directory.path, "cli.json")
  const output = path.join(directory.path, "converted.json")
  await Bun.write(source, JSON.stringify({ keybinds: { session_list: "ctrl+l", "session.list": "none" } }))
  await FileConversion.convert(source, output, "display")
  expect((await Bun.file(output).json()).keybinds).toEqual({ "session.list": "none" })
})

test("raw history conversion migrates a staged snapshot without touching its source", async () => {
  await using directory = await tmpdir()
  const filename = path.join(directory.path, "old.db")
  const output = path.join(directory.path, "converted.db")
  const { Effect, Layer } = await import("effect")
  const { Database } = await import("@opencode/core/database/database")
  const { Global } = await import("@opencode/util/global")
  await Effect.runPromise(
    Layer.build(Database.layer({ path: filename })).pipe(
      Effect.scoped,
      Effect.provideService(Global.Service, Global.make({ data: directory.path })),
    ),
  )
  const sqlite = await import("bun:sqlite")
  using source = new sqlite.Database(filename)
  source.run(`
    CREATE TABLE session (
      id text PRIMARY KEY, project_id text NOT NULL, workspace_id text, parent_id text,
      slug text NOT NULL, directory text NOT NULL, path text, title text NOT NULL, version text NOT NULL,
      share_url text, summary_additions integer, summary_deletions integer, summary_files integer, summary_diffs text,
      metadata text, cost real NOT NULL DEFAULT 0, tokens_input integer NOT NULL DEFAULT 0,
      tokens_output integer NOT NULL DEFAULT 0, tokens_reasoning integer NOT NULL DEFAULT 0,
      tokens_cache_read integer NOT NULL DEFAULT 0, tokens_cache_write integer NOT NULL DEFAULT 0,
      revert text, permission text, agent text, model text, time_created integer NOT NULL,
      time_updated integer NOT NULL, time_compacting integer, time_archived integer
    );
    CREATE TABLE message (id text PRIMARY KEY, session_id text NOT NULL, time_created integer, time_updated integer, data text);
    CREATE TABLE part (id text PRIMARY KEY, message_id text, session_id text, time_created integer, time_updated integer, data text);
    INSERT INTO project (id, worktree, time_created, time_updated, sandboxes) VALUES ('global', '/', 1, 1, '[]');
    INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated)
      VALUES ('ses_import', 'global', 'imported', '/tmp', 'Preserved', '1', 1, 2);
    INSERT INTO message VALUES ('msg_import', 'ses_import', 1, 2, '{"role":"user","time":{"created":1},"agent":"build","model":{"providerID":"provider","modelID":"model"}}');
    INSERT INTO part VALUES ('prt_import', 'msg_import', 'ses_import', 1, 2, '{"type":"text","text":"Keep this history"}');
  `)
  const original = await Bun.file(filename).arrayBuffer()
  expect(await FileConversion.inspect(filename, "history")).toMatchObject({ compatible: true, format: "database" })
  await FileConversion.convert(filename, output, "history")
  expect(await Bun.file(filename).arrayBuffer()).toEqual(original)
  using converted = new sqlite.Database(output, { readonly: true })
  expect(converted.query("SELECT title FROM session_v2").get()).toEqual({ title: "Preserved" })
  expect(
    converted.query<{ data: string }, []>("SELECT data FROM session_message WHERE type = 'user'").get()?.data,
  ).toContain("Keep this history")
  expect(await FileConversion.inspect(output, "history")).toMatchObject({ current: true })
})

test("explicit Markdown agent conversion preserves its body and nested identity in current configuration", async () => {
  await using directory = await tmpdir()
  const source = path.join(directory.path, "agents", "team", "reviewer.md")
  const output = path.join(directory.path, "converted.json")
  const text = "---\nmodel: example/chat\nvariant: high\ntools:\n  edit: false\n---\nReview this change.\n"
  await Bun.write(source, text)
  expect(await FileConversion.inspect(source)).toMatchObject({ current: false, compatible: true })
  await FileConversion.convert(source, output)
  expect(await Bun.file(source).text()).toBe(text)
  expect((await Bun.file(output).json()).agents["team/reviewer"]).toMatchObject({
    model: { providerID: "example", model: "chat", variant: "high" },
    system: "Review this change.",
    permissions: [{ action: "edit", resource: "*", effect: "deny" }],
  })
})
