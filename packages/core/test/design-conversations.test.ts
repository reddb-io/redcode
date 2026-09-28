import { expect } from "bun:test"
import { Effect } from "effect"
import { Project } from "@opencode/schema/project"
import { Session } from "@opencode/schema/session"
import { AbsolutePath } from "@opencode/schema/schema"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { Database } from "../src/database/database"
import { ProjectTable } from "../src/project/sql"
import { SessionTable } from "../src/session/sql"
import { DesignTable } from "../src/design/sql"
import { DesignConversations } from "../src/design/conversations"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node])))

it.effect("lists empty Design sessions and designs after switching agents, scoped to the directory", () =>
  Effect.gen(function* () {
    const database = yield* Database.Service
    const project = Project.ID.make("design-conversations")
    yield* database.db
      .insert(ProjectTable)
      .values({ id: project, worktree: AbsolutePath.make("/designs"), sandboxes: [] })
      .run()
      .pipe(Effect.orDie)
    yield* database.db
      .insert(SessionTable)
      .values([
        {
          id: Session.ID.make("ses_design_empty"),
          project_id: project,
          directory: "/designs",
          slug: "empty",
          agent: "design",
          version: "test",
          time_updated: 30,
        },
        {
          id: Session.ID.make("ses_design_built"),
          project_id: project,
          directory: "/designs",
          slug: "built",
          agent: "build",
          version: "test",
          time_updated: 20,
        },
        {
          id: Session.ID.make("ses_design_other"),
          project_id: project,
          directory: "/other",
          slug: "other",
          agent: "design",
          version: "test",
          time_updated: 40,
        },
        {
          id: Session.ID.make("ses_plain"),
          project_id: project,
          directory: "/designs",
          slug: "plain",
          agent: "build",
          version: "test",
          time_updated: 50,
        },
      ])
      .run()
      .pipe(Effect.orDie)
    yield* database.db
      .insert(DesignTable)
      .values([
        {
          id: "design_first",
          session_id: "ses_design_built",
          directory: "/designs",
          data: { name: "First", revision: "r1", approvedRevision: "r1", ended: false },
        },
        {
          id: "design_second",
          session_id: "ses_design_built",
          directory: "/designs",
          data: { name: "Second", revision: null, approvedRevision: null, ended: false },
        },
      ])
      .run()
      .pipe(Effect.orDie)
    const result = yield* DesignConversations.list(AbsolutePath.make("/designs"))
    expect(result.map((item) => item.sessionID)).toEqual([
      Session.ID.make("ses_design_empty"),
      Session.ID.make("ses_design_built"),
    ])
    expect(result[0].designs).toEqual([])
    expect(result[1].designs.map((item) => item.name).sort()).toEqual(["First", "Second"])
    expect(result[1].designs.find((item) => item.id === "design_first")?.approvedRevision).toBe("r1")
  }),
)
