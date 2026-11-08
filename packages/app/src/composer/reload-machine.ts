/** One server-wide configuration reload at a time. Late results are fenced by their attempt. */
export type ConfigReloadState =
  | { readonly status: "idle"; readonly issued: number }
  | { readonly status: "reloading"; readonly attempt: number }

export type ConfigReloadEvent =
  | { readonly type: "reload.requested" }
  | { readonly type: "reload.succeeded"; readonly attempt: number }
  | { readonly type: "reload.failed"; readonly attempt: number; readonly cause: unknown }

export type ConfigReloadEffect =
  | { readonly type: "reload.run"; readonly attempt: number }
  | { readonly type: "toast.pending.show" }
  | { readonly type: "toast.pending.dismiss" }
  | { readonly type: "toast.succeeded" }
  | { readonly type: "toast.failed"; readonly cause: unknown }

export function createConfigReloadState(): ConfigReloadState {
  return { status: "idle", issued: 0 }
}

export function transitionConfigReload(state: ConfigReloadState, event: ConfigReloadEvent) {
  if (event.type === "reload.requested") {
    if (state.status === "reloading") return { state, effects: [] as readonly ConfigReloadEffect[] }
    const attempt = state.issued + 1

    return {
      state: { status: "reloading" as const, attempt },
      effects: [{ type: "toast.pending.show" }, { type: "reload.run", attempt }] satisfies ConfigReloadEffect[],
    }
  }

  if (state.status !== "reloading" || state.attempt !== event.attempt)
    return { state, effects: [] as readonly ConfigReloadEffect[] }

  return {
    state: { status: "idle" as const, issued: state.attempt },
    effects: [
      { type: "toast.pending.dismiss" as const },
      event.type === "reload.succeeded"
        ? ({ type: "toast.succeeded" } as const)
        : ({ type: "toast.failed", cause: event.cause } as const),
    ],
  }
}
