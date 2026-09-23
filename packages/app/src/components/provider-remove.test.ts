import { describe, expect, test } from "bun:test"
import { providerRemoveSummary, type ProviderRemoval } from "./provider-remove"

const t = (key: string, vars?: Record<string, string | number>) =>
  vars
    ? `${key} ${Object.entries(vars)
        .map(([name, value]) => `${name}=${value}`)
        .join(" ")}`
    : key

const removal = (
  input: Omit<Partial<ProviderRemoval>, "removed"> & { removed?: Partial<ProviderRemoval["removed"]> },
) => ({
  providerID: "acme",
  dryRun: true,
  configPath: "/home/user/.config/redcode/redcode.json",
  referencingFiles: [],
  envVariables: [],
  ...input,
  removed: { credential: false, config: false, references: [], learnedLimits: 0, ...input.removed },
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
      t,
    )

    expect(summary).toEqual({
      removed: [
        "provider.remove.credential",
        "provider.remove.config",
        "provider.remove.references references=default model, agent build, S2 principal",
        "provider.remove.learnedLimits count=3",
      ],
      notes: [],
    })
  })

  test("says nothing is saved when the provider only comes from elsewhere", () => {
    expect(providerRemoveSummary(removal({}), "Acme", t).removed).toEqual(["provider.remove.nothing"])
  })

  test("notes environment variables and project files that keep the provider around", () => {
    const summary = providerRemoveSummary(
      removal({
        removed: { credential: true },
        envVariables: ["ACME_API_KEY", "ACME_TOKEN"],
        referencingFiles: ["/work/app/redcode.json"],
      }),
      "Acme",
      t,
    )

    expect(summary.notes).toEqual([
      "provider.remove.env provider=Acme variables=ACME_API_KEY, ACME_TOKEN",
      "provider.remove.files files=/work/app/redcode.json",
    ])
  })
})
