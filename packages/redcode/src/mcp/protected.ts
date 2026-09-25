import type { Client } from "@modelcontextprotocol/sdk/client/index.js"

/**
 * MCP calls that must be confirmed by the person every time, whatever the permission rules, earlier
 * approvals, `--yolo` or a client's auto-approve say. RedRouter's admin keys can create API keys,
 * list every key and read another key's usage through its MCP server; an agent must never do that
 * on its own. Tools that read only the calling key stay ordinary.
 */

/** The name RedRouter's MCP server gives itself in `initialize`. */
export const ROUTER_SERVER = "red-router"

/**
 * Why a call is protected, or undefined when it is not. `server` is the name the MCP server gave
 * itself, so a RedRouter server is recognised however it was registered.
 */
export function reason(input: { readonly server: string | undefined; readonly tool: string; readonly args: unknown }) {
  if (input.server !== ROUTER_SERVER) return
  if (input.tool === "create_api_key") return "Creates a RedRouter API key"
  if (input.tool === "list_api_keys") return "Lists every RedRouter API key this key can manage"
  const args = input.args
  if (
    input.tool === "get_usage" &&
    typeof args === "object" &&
    args !== null &&
    "api_key_id" in args &&
    args.api_key_id !== undefined
  )
    return "Reads another RedRouter API key's usage"
  return undefined
}

/**
 * The permission request for calling an MCP tool (`key` is its full name). A protected call asks
 * with `protected` and cannot be approved for later.
 */
export function ask(key: string, tool: { readonly def: { readonly name: string }; readonly client: Client }, args: unknown) {
  const why = reason({ server: tool.client.getServerVersion()?.name, tool: tool.def.name, args })
  if (!why) return { permission: key, metadata: {}, patterns: ["*"], always: ["*"] }
  return { permission: key, metadata: { protected: why }, patterns: ["*"], always: [], protected: true }
}

export * as McpProtected from "./protected"
