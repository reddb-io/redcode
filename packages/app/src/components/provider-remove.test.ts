import { describe, expect, test } from "bun:test"
import { providerRemoveSummary, type ProviderRemoval } from "./provider-remove"

const removal = (
  input: Omit<Partial<ProviderRemoval>, "removed"> & { removed?: Partial<ProviderRemoval["removed"]> },
) => ({
  providerID: "acme",
  dryRun: true,
  configPath: "/home/user/.config/redcode/redcode.json",
  referencingFiles: [],
  envVariables: [],
  ...input,
  removed: { credential: false, config: false, references: [], learnedLimits: 0, hidden: false, ...input.removed },
})

describe("providerRemoveSummary", () => {
  test("lists everything the removal clears", () => {
    const summary = providerRemoveSummary(
      removal({
        removed: {
          credential: true,
          config: true,
          references: ["default model", "agent build", "S2 principal"],
          learnedLimits: 3,
        },
      }),
      "Acme",
    )

    expect(summary).toEqual({
      removed: ["Saved key or login", "Configuration entry", "In use by: default model, agent build, S2 principal", "Learned model limits: 3"],
      notes: [],
    })
  })

  test("says nothing is saved when the provider only comes from elsewhere", () => {
    expect(providerRemoveSummary(removal({}), "Acme").removed).toEqual(["Nothing is saved for this provider."])
  })

  test("notes the hiding environment variables and project files that keep the provider around", () => {
    const summary = providerRemoveSummary(
      removal({
        removed: { credential: true, hidden: true },
        envVariables: ["ACME_API_KEY", "ACME_TOKEN"],
        referencingFiles: ["/work/app/redcode.json"],
      }),
      "Acme",
    )

    expect(summary.notes).toEqual([
      "Acme is hidden, since ACME_API_KEY, ACME_TOKEN would load it again. Connecting it again shows it.",
      "Still mentioned in: /work/app/redcode.json, which are not edited.",
    ])
  })
})
