import { createStore } from "solid-js/store"
import type { Intelligence } from "@reddb-io/redcode-schema/intelligence"

/** One readiness snapshot per server, shared by setup, model selection and prompt admission. */
export function createIntelligenceState(client: {
  get: () => Promise<Intelligence.Status>
  history: (input: { sessionID: string; limit: number }) => Promise<ReadonlyArray<Intelligence.Evaluation>>
}) {
  const [state, set] = createStore({
    status: undefined as Intelligence.Status | undefined,
    loaded: false,
    failed: false,
  })
  const pending = { request: undefined as Promise<boolean> | undefined, revision: 0 }
  const ready = () =>
    Boolean(
      !state.failed &&
        state.status?.settings.enabled &&
        state.status.settings.principal &&
        state.status.settings.evaluator,
    )
  return {
    state,
    ready,
    async history(input: { sessionID: string; limit: number }) {
      const history = await client.history(input)
      if (!Array.isArray(history)) throw new Error("Invalid evaluation history")
      return history
    },
    accept(settings: Intelligence.Settings) {
      pending.revision++
      set({
        status: { environment: state.status?.environment ?? "", evaluators: state.status?.evaluators ?? [], settings },
        loaded: true,
        failed: false,
      })
    },
    refresh() {
      const revision = pending.revision
      return (pending.request ??= client
        .get()
        .then((status) => {
          if (pending.revision !== revision) return ready()
          if (!status?.settings) throw new Error("Invalid intelligence status")
          set({ status, loaded: true, failed: false })
          return ready()
        })
        .catch(() => {
          if (pending.revision !== revision) return ready()
          set({ loaded: true, failed: true })
          return false
        })
        .finally(() => {
          pending.request = undefined
        }))
    },
  }
}
