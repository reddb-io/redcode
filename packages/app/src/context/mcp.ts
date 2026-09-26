import { useMutation } from "@tanstack/solid-query"
import { useSync } from "@/context/sync"
import { showToast } from "@/utils/toast"

export function useMcpToggle() {
  const sync = useSync()

  return useMutation(() => ({
    mutationFn: sync().mcp.toggle,
    onError: (error) =>
      showToast({
        variant: "error",
        title: "Request failed",
        description: error instanceof Error ? error.message : String(error),
      }),
  }))
}
