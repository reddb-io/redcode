import { ModelsDev } from "@opencode/core/models-dev"
import { Effect } from "effect"

export function modelCatalogFixture(source: Pick<ModelsDev.Interface, "get" | "refresh">) {
  const catalog = { source: "bundled", refreshEnabled: false } as const
  return ModelsDev.Service.of({
    ...source,
    status: () => Effect.succeed(catalog),
    refreshCatalog: () => Effect.succeed({ outcome: "disabled", catalog }),
  })
}
