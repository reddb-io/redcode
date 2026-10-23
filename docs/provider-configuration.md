# Explicit model provider configuration

Redcode does not create connections, activate model providers, fetch their remote
catalogs or complete their parameters merely because environment variables exist.
Names advertised by models.dev describe a provider; they do not authorize access.
The model catalog remains exclusively V2.

Connect a provider through **Connect provider** or TUI **/connect**, or declare
its settings explicitly in your configuration. Existing saved credentials and
selected accounts retain their values. Removing the last saved credential does
not select an environment key instead.

## Explicit environment references

An environment reference in a configuration you wrote remains supported:

```jsonc
{
  "providers": {
    "chosen": {
      "package": "@opencode/ai/providers/openai-compatible",
      "settings": {
        "baseURL": "https://models.example/v1",
        "apiKey": "{env:MY_CHOSEN_API_KEY}",
      },
      "models": { "chat": {} },
    },
  },
}
```

Only the named reference is substituted by the configuration loader. Other keys
present in the process do not become connections. A deliberately selected named
connection binding can also resolve an environment key, provided the integration
declares that name; it is never selected as a default or fallback.

## Accounts and endpoints

Configure regions, projects, resource names, accounts and gateway IDs explicitly.
Redcode's provider plugins no longer borrow AWS, Azure, Google Cloud, Cloudflare,
GitLab, Snowflake or router variables to fill those fields. Saved Snowflake
tokens and account settings are not replaced by an ambient token or account.

`${AWS_REGION}` and `${CLOUDFLARE_ACCOUNT_ID}` in a catalog URL are parameter
placeholders, not environment access instructions. The native Bedrock and
Cloudflare adapters bind these only from their explicit settings. Other provider
plugins expand their known parameters from configured values. An unresolved
placeholder produces an error asking for explicit endpoint configuration. To
reference an environment value intentionally, use `{env:VARIABLE}` in your own
configuration, or supply a complete endpoint.

External credential sources such as an ADC connection or an AWS profile remain
user choices. This policy does not sandbox external SDKs or change the operating
system's environment. OAuth application client configuration and paths used to
offer local CLI configuration choices are not model-provider connections.

## SAP AI Core

The SAP adapter requires an explicitly configured `destination` or `serviceKey`
and forwards explicit deployment and resource-group options. It never selects an
ambient service key or deployment setting. Existing explicit `serviceKey`
configuration retains the SDK's legacy bridge: that chosen key is written to the
SDK's process variable when constructing this provider. This is an explicit
credential choice, not environment discovery or credential isolation across
concurrent SDK instances. Prefer an explicit destination when available.

## Existing environment-only setups

An installation that previously relied on automatic environment detection must
save a connection or declare its provider configuration explicitly. Redcode does
not rewrite existing user files, delete credentials or restart services to apply
this policy. The [validation record](evaluations/provider-opt-in-2026-10-23-validation.json)
tracks the regressions and verification for this change.
