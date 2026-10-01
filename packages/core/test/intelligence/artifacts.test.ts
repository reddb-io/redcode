import { expect } from "bun:test"
import { IntelligenceArtifacts } from "@opencode/core/intelligence/artifacts"
import { IntelligenceLearning } from "@opencode/core/intelligence/learning"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { Effect, Exit } from "effect"
import { tempGlobalLayer } from "../fixture/global"
import { testEffect } from "../lib/effect"
import { evaluation } from "./fixtures"

const it = testEffect(
  LayerNode.compile(IntelligenceArtifacts.node, { replacements: [Global.node.replace(tempGlobalLayer)] }),
)

it.live("persists a proposal, scopes reads to its Session and marks review without installing guidance", () =>
  Effect.gen(function* () {
    const artifacts = yield* IntelligenceArtifacts.Service
    const proposal = IntelligenceLearning.candidate(
      evaluation(),
      evaluation({ id: "eval_after", candidateID: "msg_after", decision: "accepted", created: 2 }),
    )!
    yield* artifacts.save(proposal)
    expect(yield* artifacts.list(proposal.sessionID)).toEqual([proposal])
    expect(yield* artifacts.list("ses_other")).toEqual([])
    expect(Exit.isFailure(yield* artifacts.get("ses_other", proposal.id).pipe(Effect.exit))).toBe(true)
    const reviewed = yield* artifacts.review(proposal.sessionID, proposal.id, {
      status: "approved",
      reason: "Reviewed both evidence artifacts",
    })
    expect(reviewed).toMatchObject({ status: "approved", evaluations: proposal.evaluations })
    expect(yield* artifacts.get(proposal.sessionID, proposal.id)).toEqual(reviewed)
    expect(yield* artifacts.list(proposal.sessionID)).toHaveLength(1)
  }),
)

it.live("persists an inspectable curation manifest but refuses candidate-review operations on it", () =>
  Effect.gen(function* () {
    const artifacts = yield* IntelligenceArtifacts.Service
    const manifest = {
      type: "curation" as const,
      id: "curation",
      sessionID: "ses_fixture",
      subjectID: "msg_request",
      policy: "test",
      created: 1,
      omitted: [{ messageID: "msg_old", hash: "hash", evaluationID: "eval" }],
    }
    yield* artifacts.save(manifest)
    expect(yield* artifacts.get(manifest.sessionID, manifest.id)).toEqual(manifest)
    expect(
      Exit.isFailure(
        yield* artifacts.review(manifest.sessionID, manifest.id, { status: "approved" }).pipe(Effect.exit),
      ),
    ).toBe(true)
  }),
)
