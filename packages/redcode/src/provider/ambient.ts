/** Providers that load only once connected or configured, never from the environment alone. */
const OPT_IN = new Set<string>(["amazon-bedrock"])

/** Variables a provider's loader reads besides its catalog `env`, and that load it on their own. */
const LOADER_ENV: Record<string, ReadonlyArray<string>> = {
  "google-vertex": ["GOOGLE_CLOUD_PROJECT", "GCP_PROJECT", "GCLOUD_PROJECT"],
  "google-vertex-anthropic": ["GOOGLE_CLOUD_PROJECT", "GCP_PROJECT", "GCLOUD_PROJECT"],
  "cloudflare-ai-gateway": ["CF_AIG_TOKEN"],
  "snowflake-cortex": ["SNOWFLAKE_CORTEX_TOKEN"],
}

/** Whether a provider loads only once connected or configured, whatever the environment holds. */
export function optIn(providerID: string) {
  return OPT_IN.has(providerID)
}

/**
 * The environment variables that load a provider with nothing saved or configured for it: its
 * catalog variables plus the ones its loader reads. Opt-in providers have none.
 */
export function env(providerID: string, catalog: ReadonlyArray<string> = []) {
  if (optIn(providerID)) return []
  return [...new Set([...catalog, ...(LOADER_ENV[providerID] ?? [])])]
}

export * as ProviderAmbient from "./ambient"
