import type {
  AgentListOutput,
  ModelDefaultOutput,
  ModelListOutput,
  PermissionV2Request,
  ProviderListOutput,
} from "@opencode-ai/client/promise"
import type { Agent, PermissionRequest, Project, Provider, ProviderListResponse } from "@reddb-io/redcode-sdk/v2/client"
import type { Project as CurrentProject } from "@opencode-ai/client/promise"
import { NormalizedProviderListResponse } from "@reddb-io/redcode-session-ui/context"
export { pathKey as directoryKey, type PathKey as DirectoryKey } from "@/utils/path-key"

export const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

export function normalizeAgentList(input: AgentListOutput["data"] | Agent[]): Agent[] {
  if (input.every((agent) => !("request" in agent))) return input as Agent[]
  return (input as AgentListOutput["data"]).map((agent) => ({
    name: agent.id,
    description: agent.description,
    mode: agent.mode,
    hidden: agent.hidden,
    temperature:
      typeof agent.request.settings.temperature === "number" ? agent.request.settings.temperature : undefined,
    topP: typeof agent.request.settings.topP === "number" ? agent.request.settings.topP : undefined,
    color: agent.color,
    permission: agent.permissions.map((rule) => ({
      permission: rule.action,
      pattern: rule.resource,
      action: rule.effect,
    })),
    model: agent.model && { providerID: agent.model.providerID, modelID: agent.model.id },
    variant: agent.model?.variant,
    prompt: agent.system,
    options: agent.request.settings,
    steps: agent.steps,
  }))
}

export function normalizePermissionRequest(input: PermissionV2Request | PermissionRequest): PermissionRequest {
  if ("permission" in input) return input
  return {
    id: input.id,
    sessionID: input.sessionID,
    permission: input.action,
    patterns: input.resources,
    always: input.save ?? [],
    metadata: input.metadata ?? {},
    tool:
      input.source?.type === "tool" ? { messageID: input.source.messageID, callID: input.source.callID } : undefined,
  }
}

export function normalizeProviderList(
  providers: ProviderListOutput["data"] | ProviderListResponse,
  models?: ModelListOutput["data"],
  defaultModel?: ModelDefaultOutput["data"],
): NormalizedProviderListResponse {
  if (!Array.isArray(providers)) {
    return {
      ...providers,
      all: new Map(
        providers.all.map((provider) => [
          provider.id,
          {
            ...provider,
            models: Object.fromEntries(
              Object.entries(provider.models).filter(([, model]) => model.status !== "deprecated"),
            ),
          },
        ]),
      ),
    }
  }
  const all = new Map<string, Provider>()

  for (const provider of providers) {
    all.set(provider.id, {
      id: provider.id,
      name: provider.name,
      source: "custom",
      env: [],
      options: provider.settings ?? {},
      models: {},
      ...routerOf(provider),
    })
  }

  for (const model of models ?? []) {
    const provider = all.get(model.providerID)
    if (!provider || model.status === "deprecated") continue
    const cost = model.cost.find((item) => item.tier === undefined) ?? model.cost[0]
    provider.models[model.id] = {
      id: model.id,
      providerID: model.providerID,
      api: {
        id: model.modelID,
        url: "",
        npm: model.package ?? provider.id,
      },
      name: model.name,
      family: model.family,
      capabilities: {
        temperature: false,
        reasoning: false,
        attachment: model.capabilities.input.some((item) => item !== "text"),
        toolcall: model.capabilities.tools,
        input: {
          text: model.capabilities.input.includes("text"),
          audio: model.capabilities.input.includes("audio"),
          image: model.capabilities.input.includes("image"),
          video: model.capabilities.input.includes("video"),
          pdf: model.capabilities.input.includes("pdf"),
        },
        output: {
          text: model.capabilities.output.includes("text"),
          audio: model.capabilities.output.includes("audio"),
          image: model.capabilities.output.includes("image"),
          video: model.capabilities.output.includes("video"),
          pdf: model.capabilities.output.includes("pdf"),
        },
        interleaved: false,
      },
      cost: {
        input: cost?.input ?? 0,
        output: cost?.output ?? 0,
        cache: {
          read: cost?.cache.read ?? 0,
          write: cost?.cache.write ?? 0,
        },
      },
      limit: model.limit,
      status: model.status,
      options: model.settings ?? {},
      headers: model.headers ?? {},
      release_date: new Date(model.time.released).toISOString().slice(0, 10),
      variants: Object.fromEntries(model.variants.map((variant) => [variant.id, variant.settings ?? {}])),
      ...routingOf(model),
    }
  }

  return {
    all,
    connected: providers.map((provider) => provider.id),
    defaultModel: defaultModel ? { providerID: defaultModel.providerID, modelID: defaultModel.id } : null,
    default: Object.fromEntries(
      providers.flatMap((provider) => {
        const model =
          defaultModel?.providerID === provider.id
            ? defaultModel
            : models?.find((item) => item.providerID === provider.id && item.status !== "deprecated")
        return model ? [[provider.id, model.id]] : []
      }),
    ),
  }
}

type ProviderModel = Provider["models"][string]

/**
 * The router a current server reports on a provider (RedRouter or 9Router), so a routed connection
 * is recognised by what it is rather than by its id. Servers that do not report one leave it out.
 */
function routerOf(provider: object): Pick<Provider, "router"> {
  const router = "router" in provider && isRecord(provider.router) ? provider.router : {}
  const kind = router.kind
  if (kind !== "red-router" && kind !== "9router") return {}
  return {
    router: {
      kind,
      ...(typeof router.instanceID === "string" ? { instanceID: router.instanceID } : {}),
      ...(typeof router.version === "string" ? { version: router.version } : {}),
    },
  }
}

/** What a current server reports about a routed model: its upstream, earlier ids, modes and router in between. */
function routingOf(model: object): Pick<ProviderModel, "upstream" | "aliases" | "modes" | "routerVariants" | "via"> {
  const value: Record<string, unknown> = { ...model }
  const upstream = value.upstream
  const variants = Array.isArray(value.routerVariants)
    ? value.routerVariants.flatMap((item) =>
        isRecord(item) && typeof item.id === "string" ? [variantOf(item, item.id)] : [],
      )
    : []
  return {
    ...(isRecord(upstream) && typeof upstream.id === "string" && typeof upstream.name === "string"
      ? {
          upstream: {
            id: upstream.id,
            name: upstream.name,
            ...(typeof upstream.slug === "string" ? { slug: upstream.slug } : {}),
            ...(typeof upstream.category === "string" ? { category: upstream.category } : {}),
            ...(typeof upstream.subscription === "boolean" ? { subscription: upstream.subscription } : {}),
          },
        }
      : {}),
    ...(strings(value.aliases).length ? { aliases: strings(value.aliases) } : {}),
    ...(strings(value.modes).length ? { modes: strings(value.modes) } : {}),
    ...(variants.length ? { routerVariants: variants } : {}),
    ...(typeof value.via === "string" ? { via: value.via } : {}),
  }
}

function variantOf(item: Record<string, unknown>, id: string) {
  return {
    id,
    ...(typeof item.name === "string" ? { name: item.name } : {}),
    ...(typeof item.level === "string" ? { level: item.level } : {}),
    ...(typeof item.mode === "string" ? { mode: item.mode } : {}),
    ...(strings(item.aliases).length ? { aliases: strings(item.aliases) } : {}),
  }
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export function sanitizeProject(project: Project) {
  if (!project.icon?.url && !project.icon?.override) return project
  return {
    ...project,
    icon: {
      ...project.icon,
      url: undefined,
      override: undefined,
    },
  }
}

export function normalizeProjectInfo(project: Project | CurrentProject): Project {
  return {
    ...project,
    vcs: project.vcs === "git" ? "git" : undefined,
  }
}
