import { expect, test } from "bun:test"
import { Schema } from "effect"
import { Design } from "@reddb-io/redcode-schema/design"
import { DesignParams } from "../src/design/params"

const controls: Design.ParamComponent[] = [
  {
    id: "wizard",
    name: "Wizard",
    selector: "#wizard",
    fields: [
      { id: "step", name: "Step", type: "number", default: 1, min: 1, max: 3 },
      { id: "outcome", name: "Outcome", type: "select", default: "success", options: ["success", "error"] },
    ],
  },
]

test("parameter contract preserves older documents and optional feedback context", () => {
  expect(Schema.decodeUnknownSync(Design.Update)({ name: "Existing" })).toEqual({ name: "Existing" })
  const update = {
    controls,
    presets: [{ id: "error", name: "Step two failure", values: { wizard: { step: 2, outcome: "error" } } }],
  }
  expect(Schema.decodeUnknownSync(Design.Update)(update)).toEqual(update)
  expect(() => DesignParams.validate({ ...update, scenarios: [] })).not.toThrow()
})

test("rejects undeclared fields, duplicate components and unreachable values", () => {
  expect(() => DesignParams.validate({ controls: [...controls, ...controls], scenarios: [] })).toThrow("unique")
  const invalid: Design.ParamValues[] = [
    { wizard: { step: 4 } },
    { wizard: { outcome: "unknown" } },
    { wizard: { other: true } },
    { missing: { step: 1 } },
  ]
  for (const values of invalid) {
    expect(() =>
      DesignParams.validate({ controls, scenarios: [], presets: [{ id: "bad", name: "Bad preset", values }] }),
    ).toThrow()
  }
  expect(() =>
    DesignParams.validate({
      controls: [{ ...controls[0], fields: [{ id: "step", name: "Step", type: "number", default: 5, max: 3 }] }],
      scenarios: [],
    }),
  ).toThrow("default")
})
