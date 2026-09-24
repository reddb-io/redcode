import os from "os"
import path from "path"
import type { Hooks } from "@reddb-io/redcode-plugin"
import { OAUTH_DUMMY_KEY } from "../auth/dummy-key"

type Env = Record<string, string | undefined>

export type AwsProfile = {
  name: string
  region?: string
  sso: boolean
  keys: boolean
}

/**
 * Connecting Amazon Bedrock. Bedrock is opt-in, so AWS credentials on the machine do not load it
 * on their own; these methods import them once: an AWS profile from the shared credentials and
 * config files, the AWS credentials in the environment, or a Bedrock API key. An imported setup
 * is saved with the placeholder key and its profile and region, and resolves through the AWS
 * credential chain when Bedrock loads. Connecting again replaces the saved setup.
 */
export async function AmazonBedrockAuthPlugin(): Promise<Hooks> {
  const home = os.homedir()
  const read = (file: string) =>
    Bun.file(file)
      .text()
      .catch(() => "")
  return amazonBedrockAuthHooks(
    process.env,
    awsProfiles({
      credentials: await read(process.env.AWS_SHARED_CREDENTIALS_FILE || path.join(home, ".aws", "credentials")),
      config: await read(process.env.AWS_CONFIG_FILE || path.join(home, ".aws", "config")),
    }),
  )
}

export function amazonBedrockAuthHooks(env: Env, profiles: ReadonlyArray<AwsProfile>): Hooks {
  const region = {
    type: "text" as const,
    key: "region",
    message: `AWS region (leave empty for the profile's region or ${env.AWS_REGION || "us-east-1"})`,
    placeholder: env.AWS_REGION || "us-east-1",
  }
  const imported = (metadata: Record<string, string>, instructions: string) => ({
    url: "",
    method: "auto" as const,
    instructions,
    callback: async () => ({ type: "success" as const, key: OAUTH_DUMMY_KEY, metadata }),
  })
  const profileMethod = {
    type: "oauth" as const,
    label: "Import an AWS profile (~/.aws)",
    prompts: [
      {
        type: "select" as const,
        key: "profile",
        message: "AWS profile",
        options: profiles.map((profile) => ({
          label: profile.name,
          value: profile.name,
          hint: [profile.sso ? "SSO" : profile.keys ? "access keys" : "", profile.region ?? ""]
            .filter(Boolean)
            .join(", "),
        })),
      },
      region,
    ],
    async authorize(inputs?: Record<string, string>) {
      const profile = profiles.find((item) => item.name === inputs?.profile) ?? profiles[0]
      return imported(
        { profile: profile.name, region: inputs?.region || profile.region || env.AWS_REGION || "us-east-1" },
        profile.sso
          ? `Uses the AWS SSO profile ${profile.name}. Run \`aws sso login --profile ${profile.name}\` when its session expires.`
          : `Uses the AWS profile ${profile.name}.`,
      )
    },
  }
  const environmentMethod = {
    type: "oauth" as const,
    label: `Use the AWS credentials in the environment (${environmentCredentials(env).join(", ")})`,
    prompts: [region],
    async authorize(inputs?: Record<string, string>) {
      return imported(
        { region: inputs?.region || env.AWS_REGION || "us-east-1" },
        "Uses the AWS credentials in the environment Redcode runs in.",
      )
    },
  }
  return {
    auth: {
      provider: "amazon-bedrock",
      methods: [
        ...(profiles.length ? [profileMethod] : []),
        ...(environmentCredentials(env).length ? [environmentMethod] : []),
        { type: "api", label: "Bedrock API key", prompts: [region] },
      ],
    },
  }
}

/** The AWS credential variables set in the environment, by name. */
export function environmentCredentials(env: Env) {
  return [
    "AWS_PROFILE",
    "AWS_ACCESS_KEY_ID",
    "AWS_BEARER_TOKEN_BEDROCK",
    "AWS_WEB_IDENTITY_TOKEN_FILE",
    "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
    "AWS_CONTAINER_CREDENTIALS_FULL_URI",
  ].filter((name) => env[name])
}

/**
 * The profiles in the AWS shared credentials and config files. The config file names them
 * `[profile name]` (or `[default]`); `[sso-session ...]` and other sections are not profiles.
 */
export function awsProfiles(files: { credentials: string; config: string }) {
  const profiles = new Map<string, AwsProfile>()
  const entry = (name: string) => {
    const existing = profiles.get(name)
    if (existing) return existing
    const created: AwsProfile = { name, sso: false, keys: false }
    profiles.set(name, created)
    return created
  }
  for (const [section, values] of ini(files.credentials)) {
    const profile = entry(section)
    profile.keys = profile.keys || Boolean(values.aws_access_key_id)
  }
  for (const [section, values] of ini(files.config)) {
    const name = section === "default" ? "default" : section.match(/^profile\s+(.+)$/)?.[1]?.trim()
    if (!name) continue
    const profile = entry(name)
    profile.region = values.region || profile.region
    profile.sso = profile.sso || Boolean(values.sso_session || values.sso_start_url)
    profile.keys = profile.keys || Boolean(values.aws_access_key_id)
  }
  return [...profiles.values()]
}

function ini(text: string) {
  return text.split(/\r?\n/).reduce<Array<[string, Record<string, string>]>>((sections, raw) => {
    const line = raw.trim()
    if (!line || line.startsWith("#") || line.startsWith(";")) return sections
    const header = line.match(/^\[(.+)\]$/)
    if (header) return [...sections, [header[1].trim(), {}]]
    const pair = line.match(/^([^=]+?)\s*=\s*(.*)$/)
    const current = sections.at(-1)
    if (pair && current) current[1][pair[1].trim()] = pair[2].trim()
    return sections
  }, [])
}
