import type { CostAssessment } from "@opencode/schema/cost-assessment"

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })

export function formatCost(amount: number | undefined, assessment?: CostAssessment.Summary) {
  if (amount === undefined) return "cost unavailable"
  if (assessment?.status === "unknown") return amount === 0 ? "cost unknown" : `${money.format(amount)}+`
  if (!assessment || assessment.status === "legacy") return `${money.format(amount)}*`
  if (assessment.status === "estimated") return `~${money.format(amount)}`
  return money.format(amount)
}
