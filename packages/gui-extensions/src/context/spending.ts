import { createMemo, type Accessor } from "solid-js"
import type { CostAssessment } from "@opencode/schema/cost-assessment"
import { createKeyed, type MountedSession } from "../sdk"

/** Shares the server's descendant-inclusive budget snapshot between the panel and header. */
export function createSessionSpending(session: Accessor<MountedSession>) {
  const target = createMemo(
    () => {
      const current = session()

      return current.id && current.server.connected ? { data: current.server.data, id: current.id } : undefined
    },
    undefined,
    { equals: (a, b) => a?.data === b?.data && a?.id === b?.id },
  )

  createKeyed(target, (current) => void current.data.session.spend.sync(current.id).catch(() => undefined))

  return createMemo(() => {
    const current = session()

    return current.id ? current.server.data.session.spend.get(current.id) : undefined
  })
}

export function formatCost(
  amount: number | undefined,
  assessment: CostAssessment.Summary | undefined,
  format: (amount: number) => string,
  t: (key: string) => string,
) {
  if (amount === undefined) return t("cost.unavailable")
  if (assessment?.status === "unknown") return amount === 0 ? t("cost.unknown") : `${format(amount)}+`
  if (!assessment || assessment.status === "legacy") return `${format(amount)}*`
  if (assessment.status === "estimated") return `~${format(amount)}`

  return format(amount)
}
