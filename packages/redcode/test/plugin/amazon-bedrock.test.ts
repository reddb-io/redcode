import { describe, expect, test } from "bun:test"
import type { Hooks } from "@reddb-io/redcode-plugin"
import { OAUTH_DUMMY_KEY } from "../../src/auth"
import { amazonBedrockAuthHooks, awsProfiles } from "../../src/plugin/amazon-bedrock"
import { ProviderAmbient } from "../../src/provider/ambient"

const CREDENTIALS = `
[default]
aws_access_key_id = AKIA_DEFAULT
aws_secret_access_key = secret

[ci]
aws_access_key_id=AKIA_CI
`

const CONFIG = `
# comment
[default]
region = us-west-2

[profile work]
sso_session = corp
sso_account_id = 123456789012
region = eu-central-1

[sso-session corp]
sso_start_url = https://corp.awsapps.com/start
`

function labels(hooks: Hooks) {
  return hooks.auth?.methods.map((method) => method.label) ?? []
}

async function imported(hooks: Hooks, index: number, inputs: Record<string, string>) {
  const method = hooks.auth?.methods[index]
  if (method?.type !== "oauth") throw new Error("expected an import method")
  const authorization = await method.authorize(inputs)
  if (authorization.method !== "auto") throw new Error("expected an automatic import")
  return { authorization, result: await authorization.callback() }
}

describe("awsProfiles", () => {
  test("reads profiles from the credentials and config files, skipping sso-session sections", () => {
    expect(awsProfiles({ credentials: CREDENTIALS, config: CONFIG })).toEqual([
      { name: "default", region: "us-west-2", sso: false, keys: true },
      { name: "ci", sso: false, keys: true },
      { name: "work", region: "eu-central-1", sso: true, keys: false },
    ])
  })

  test("returns nothing without the files", () => {
    expect(awsProfiles({ credentials: "", config: "" })).toEqual([])
  })
})

describe("amazonBedrockAuthHooks", () => {
  test("offers only the API key without AWS profiles or environment credentials", () => {
    expect(labels(amazonBedrockAuthHooks({}, []))).toEqual(["Bedrock API key"])
  })

  test("offers to import a profile and the environment credentials when present", () => {
    const hooks = amazonBedrockAuthHooks(
      { AWS_PROFILE: "work", AWS_ACCESS_KEY_ID: "AKIA" },
      awsProfiles({ credentials: CREDENTIALS, config: CONFIG }),
    )
    expect(labels(hooks)).toEqual([
      "Import an AWS profile (~/.aws)",
      "Use the AWS credentials in the environment (AWS_PROFILE, AWS_ACCESS_KEY_ID)",
      "Bedrock API key",
    ])
    const method = hooks.auth?.methods[0]
    const select = method?.prompts?.[0]
    expect(select?.type === "select" ? select.options.map((option) => [option.value, option.hint]) : []).toEqual([
      ["default", "access keys, us-west-2"],
      ["ci", "access keys"],
      ["work", "SSO, eu-central-1"],
    ])
  })

  test("importing a profile saves it with the placeholder key and its region", async () => {
    const hooks = amazonBedrockAuthHooks({}, awsProfiles({ credentials: CREDENTIALS, config: CONFIG }))
    const work = await imported(hooks, 0, { profile: "work", region: "" })
    expect(work.authorization.instructions).toContain("aws sso login --profile work")
    expect(work.result).toEqual({
      type: "success",
      key: OAUTH_DUMMY_KEY,
      metadata: { profile: "work", region: "eu-central-1" },
    })
    // Connecting again with another profile and region replaces the saved setup.
    expect((await imported(hooks, 0, { profile: "ci", region: "ap-south-1" })).result).toEqual({
      type: "success",
      key: OAUTH_DUMMY_KEY,
      metadata: { profile: "ci", region: "ap-south-1" },
    })
  })

  test("using the environment credentials saves the region only", async () => {
    const hooks = amazonBedrockAuthHooks({ AWS_ACCESS_KEY_ID: "AKIA", AWS_REGION: "eu-west-1" }, [])
    expect((await imported(hooks, 0, {})).result).toEqual({
      type: "success",
      key: OAUTH_DUMMY_KEY,
      metadata: { region: "eu-west-1" },
    })
  })
})

describe("ProviderAmbient.env", () => {
  test("opt-in providers have no environment variables that load them", () => {
    expect(ProviderAmbient.env("amazon-bedrock", ["AWS_ACCESS_KEY_ID", "AWS_REGION"])).toEqual([])
  })

  test("adds the variables a loader reads besides the catalog ones", () => {
    expect(ProviderAmbient.env("google-vertex", ["GOOGLE_VERTEX_PROJECT"])).toEqual([
      "GOOGLE_VERTEX_PROJECT",
      "GOOGLE_CLOUD_PROJECT",
      "GCP_PROJECT",
      "GCLOUD_PROJECT",
    ])
    expect(ProviderAmbient.env("anthropic", ["ANTHROPIC_API_KEY"])).toEqual(["ANTHROPIC_API_KEY"])
  })
})
