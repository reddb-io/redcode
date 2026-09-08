import { expect } from "bun:test"
import path from "node:path"
import { Effect } from "effect"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { LSP } from "@/lsp/lsp"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LSP.node))
const command = [Bun.which("node")!, path.join(import.meta.dir, "../fixture/lsp/fake-lsp-server.js")]

it.instance(
  "recovered Node LSPs stay connected and independently recover the same rejected option",
  () =>
    LSP.Service.use((lsp) =>
      Effect.gen(function* () {
        const root = (yield* TestInstance).directory
        yield* Effect.all(
          [lsp.touchFile(path.join(root, "first.recovery-a")), lsp.touchFile(path.join(root, "second.recovery-b"))],
          { concurrency: "unbounded" },
        )
        yield* Effect.sleep("100 millis")
        const status = yield* lsp.status()
        expect(
          status
            .filter((item) => item.status === "connected")
            .map((item) => item.id)
            .sort(),
        ).toEqual(["recovery-a", "recovery-b"])
        expect(status.filter((item) => item.status === "error")).toEqual([])
      }),
    ),
  {
    config: {
      lsp: {
        "recovery-a": {
          command,
          extensions: [".recovery-a"],
          env: { NODE_OPTIONS: "--user-system-ca --max-old-space-size=256" },
        },
        "recovery-b": {
          command,
          extensions: [".recovery-b"],
          env: { NODE_OPTIONS: '"--user-system-ca" --max-old-space-size=256' },
        },
      },
    },
  },
)
