/** @jsxImportSource react */
import { useSyncExternalStore } from "react"
import { Badge } from "@reddb-io/design-system/base/Badge"
import { Button } from "@reddb-io/design-system/base/Button"
import { Progress } from "@reddb-io/design-system/base/Progress"
import { Select } from "@reddb-io/design-system/base/Select"
import { Skeleton } from "@reddb-io/design-system/base/Skeleton"
import { SessionTodo } from "@opencode/schema/session-todo"
import type { createAgentTaskServices } from "./agents-tasks"

export function AgentTasksView(props: { services: ReturnType<typeof createAgentTaskServices> }) {
  const services = props.services
  const view = useSyncExternalStore(services.snapshot.subscribe, services.snapshot.getSnapshot)
  const language = view.language
  const task = view.report?.task ?? view.task
  const report = view.report
  const candidate = view.review?.candidate
  const binding = report?.integration
  const application = task?.integrationApplication
  const applied =
    application?.state === "applied" &&
    application.head === task?.integration?.head &&
    application.target === task.integration.target &&
    application.targetHead === task.integration.targetHead &&
    application.fingerprint === task.integration.fingerprint
  const pending = !applied && (!!view.request || application?.state === "pending")
  const available = view.connected && !view.unavailable && !view.loading && !view.busy
  const reviewed =
    candidate?.status === "ready" &&
    !candidate.truncated &&
    candidate.head === binding?.binding.head &&
    candidate.tree === binding?.binding.tree &&
    view.review?.revision === task?.revision
  const accepted =
    task?.status === "completed" &&
    !!task.evidence &&
    report?.executionSettled &&
    report.acceptanceReady &&
    binding?.contractCurrent
  const completed = view.tasks.filter((item) => item.status === "completed").length
  const status = (value: string) => language.t(STATUSES[value as keyof typeof STATUSES] ?? "agentTasks.status.unknown")
  return (
    <div className="flex min-w-0 flex-col gap-4 text-13-regular leading-[var(--line-height-base)]">
      <p className="max-w-prose text-ink-muted">{language.t("agentTasks.description")}</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          {language.t("agentTasks.session")}
          <Select
            aria-label={language.t("agentTasks.session")}
            value={view.sessionID}
            disabled={!view.connected || view.busy || view.sessionsError}
            onValueChange={services.selectSession}
            options={[
              { value: "", label: language.t("agentTasks.chooseSession") },
              ...view.sessions.map((item) => ({ value: item.id, label: item.title || item.id })),
            ]}
          />
        </label>
        <Button variant="secondary" disabled={!view.connected || view.busy} onClick={services.refresh}>
          {language.t("agentTasks.refresh")}
        </Button>
        {view.session && (
          <Button variant="ghost" onClick={services.open}>
            {language.t("agentTasks.openSession")}
          </Button>
        )}
      </div>
      {!view.connected && <p role="status">{language.t("agentTasks.disconnected")}</p>}
      {view.unavailable && <p role="alert">{language.t("agentTasks.unavailable")}</p>}
      {view.error && <p role="alert">{view.error}</p>}
      {view.loading && <Skeleton label={language.t("agentTasks.loading")} className="h-16 w-full" />}
      {view.session && view.connected && !view.listUnavailable && (
        <>
          <section
            aria-label={language.t("agentTasks.objective")}
            className="border-b border-v2-border-border-base pb-4"
          >
            <h3 className="text-13-medium">{language.t("agentTasks.objective")}</h3>
            {view.goalError ? (
              <p role="status">{language.t("agentTasks.goalUnavailable")}</p>
            ) : (
              <p className="whitespace-pre-wrap">{view.goal?.objective || language.t("agentTasks.noGoal")}</p>
            )}
            {!!view.goal?.criteria.length && (
              <ul className="list-disc ps-5">
                {view.goal.criteria.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            )}
            <Progress
              label={language.t("agentTasks.progress")}
              value={completed}
              max={Math.max(1, view.tasks.length)}
              summary
              formatValue={() => language.plural("agentTasks.completed", completed, { total: view.tasks.length })}
              className="mt-3 max-w-xl"
            />
          </section>
          {!view.loading && view.tasks.length === 0 && <p role="status">{language.t("agentTasks.empty")}</p>}
          <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(180px,1fr)_minmax(0,2fr)]">
            <ul aria-label={language.t("agentTasks.dependencies")} className="min-w-0 space-y-4">
              {view.tasks.map((item, index) => (
                <li key={item.id ?? index}>
                  <Button
                    variant={item.id === view.taskID ? "secondary" : "ghost"}
                    className="h-auto min-h-[var(--reddb-spatial-target-min)] w-full justify-start whitespace-normal text-start"
                    disabled={!item.id || view.busy}
                    aria-pressed={!!item.id && item.id === view.taskID}
                    onClick={() => item.id && services.selectTask(item.id)}
                  >
                    <span className="flex min-w-0 flex-col items-start gap-1">
                      <span>{SessionTodo.label(item)}</span>
                      <span className="text-caption text-ink-muted">{status(item.status)}</span>
                    </span>
                  </Button>
                  {item.reason && <p className="mt-1 whitespace-pre-wrap px-3 text-ink-muted">{item.reason}</p>}
                  <div className="px-3 text-caption text-ink-muted">
                    {(item.dependencies ?? []).length === 0 ? (
                      <p>{language.t("agentTasks.noDependencies")}</p>
                    ) : (
                      <>
                        <p>{language.t("agentTasks.requires")}</p>
                        <ul className="mt-1 space-y-1">
                          {(item.dependencies ?? []).map((id) => {
                            const prerequisite = view.tasks.find((entry) => entry.id === id)
                            const waiting = view.graph.find((entry) => entry.id === item.id)?.waitingFor.includes(id)
                            return (
                              <li key={id}>
                                {prerequisite ? (
                                  <Button
                                    variant="ghost"
                                    className="h-auto min-h-[var(--reddb-spatial-target-min)] w-full justify-start whitespace-normal text-start"
                                    aria-label={language.t("agentTasks.inspectDependency", {
                                      task: SessionTodo.label(prerequisite),
                                    })}
                                    disabled={view.busy}
                                    onClick={() => services.selectTask(id)}
                                  >
                                    <span className="flex min-w-0 flex-col items-start gap-1">
                                      <span>{SessionTodo.label(prerequisite)}</span>
                                      <span className="text-caption text-ink-muted">
                                        {language.t(waiting ? "agentTasks.waitingFor" : "agentTasks.dependencyMet")}
                                      </span>
                                    </span>
                                  </Button>
                                ) : (
                                  <p>{language.t("agentTasks.missingDependency", { id })}</p>
                                )}
                              </li>
                            )
                          })}
                        </ul>
                      </>
                    )}
                    {view.assignments
                      .filter((assignment) => assignment.taskID === item.id)
                      .map((assignment) => (
                        <div key={assignment.sessionID} className="mt-2">
                          <p>{language.t("agentTasks.delegatedTo")}</p>
                          <Button
                            variant="ghost"
                            className="h-auto min-h-[var(--reddb-spatial-target-min)] max-w-full whitespace-normal break-all text-start"
                            aria-label={language.t("agentTasks.openContribution", { session: assignment.sessionID })}
                            disabled={view.busy}
                            onClick={() => services.openAssignment(assignment.sessionID)}
                          >
                            {assignment.sessionID}
                          </Button>
                          <p>{language.t("agentTasks.assignmentRevision", { revision: assignment.revision })}</p>
                          <p>{status(assignment.state)}</p>
                          {assignment.state === "settled" && assignment.outcome && <p>{status(assignment.outcome)}</p>}
                          {!assignment.current && <Badge>{status("stale")}</Badge>}
                        </div>
                      ))}
                  </div>
                </li>
              ))}
            </ul>
            {task && (
              <section aria-label={language.t("agentTasks.detail")} className="flex min-w-0 flex-col gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-13-medium">{SessionTodo.label(task)}</h3>
                    <Badge>{status(task.status)}</Badge>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap">{task.content}</p>
                  {task.reason && <p className="mt-2 whitespace-pre-wrap">{task.reason}</p>}
                  {task.criterion && (
                    <div className="mt-3">
                      <h4 className="text-13-medium">{language.t("agentTasks.criterion")}</h4>
                      <p className="whitespace-pre-wrap">{task.criterion}</p>
                    </div>
                  )}
                  {task.source && (
                    <blockquote className="mt-3 border-s-2 border-v2-border-border-base ps-3 whitespace-pre-wrap text-ink-muted">
                      {task.source.quote}
                    </blockquote>
                  )}
                  {task.evidence && (
                    <div className="mt-3">
                      <h4 className="text-13-medium">{language.t("agentTasks.evidence")}</h4>
                      <p className="whitespace-pre-wrap">{task.evidence.explanation}</p>
                      <p className="break-all text-caption text-ink-muted">
                        {task.evidence.tool} · {task.evidence.callID}
                      </p>
                    </div>
                  )}
                </div>
                {report && (
                  <>
                    <p role="status">
                      {language.t(report.executionSettled ? "agentTasks.settled" : "agentTasks.executing")}
                    </p>
                    <div>
                      <h4 className="text-13-medium">{language.t("agentTasks.prerequisites")}</h4>
                      <p className="text-ink-muted">
                        {language.t(report.acceptanceReady ? "agentTasks.inputsAccepted" : "agentTasks.inputsPending")}
                      </p>
                      {report.inputs.map((input) => (
                        <article
                          key={input.task.id}
                          aria-label={SessionTodo.label(input.task)}
                          className="mt-3 border-s-2 border-v2-border-border-base ps-3"
                        >
                          <h5 className="text-13-medium">{SessionTodo.label(input.task)}</h5>
                          <Badge>{status(input.acceptance)}</Badge>
                          {input.issues.map((issue, index) => (
                            <p key={index} className="mt-1 whitespace-pre-wrap">
                              {issue}
                            </p>
                          ))}
                          {input.contributions.map((contribution) => (
                            <details key={contribution.sessionID + contribution.promptID} className="mt-2">
                              <summary className="cursor-pointer py-1">
                                {language.t("agentTasks.contribution", {
                                  session: contribution.sessionID,
                                  status: status(contribution.execution),
                                })}
                              </summary>
                              <p>{language.t(contribution.current ? "agentTasks.current" : "agentTasks.outdated")}</p>
                              {contribution.response && (
                                <p className="mt-2 whitespace-pre-wrap">{contribution.response.text}</p>
                              )}
                              {contribution.response?.truncated && <p>{language.t("agentTasks.truncatedSummary")}</p>}
                              <h6 className="mt-2 text-13-medium">{language.t("agentTasks.checks")}</h6>
                              <ul className="list-disc ps-5">
                                {contribution.checks.map((check) => (
                                  <li key={check.messageID + check.callID} className="break-all">
                                    {language.t("agentTasks.check", {
                                      tool: check.tool,
                                      call: check.callID,
                                      status: status(
                                        !check.settled
                                          ? "running"
                                          : !check.successful
                                            ? "failed"
                                            : check.fresh
                                              ? "succeeded"
                                              : "stale",
                                      ),
                                    })}
                                  </li>
                                ))}
                              </ul>
                              {contribution.omittedChecks > 0 && (
                                <p>{language.plural("agentTasks.omittedChecks", contribution.omittedChecks)}</p>
                              )}
                              <h6 className="mt-2 text-13-medium">{language.t("agentTasks.files")}</h6>
                              <ul className="list-disc ps-5">
                                {contribution.changedPaths.map((path) => (
                                  <li key={path} className="break-all font-mono">
                                    {path}
                                  </li>
                                ))}
                              </ul>
                              {contribution.omittedPaths > 0 && (
                                <p>{language.plural("agentTasks.omittedPaths", contribution.omittedPaths)}</p>
                              )}
                              {contribution.unknownWriteScope && <p>{language.t("agentTasks.unknownWrites")}</p>}
                            </details>
                          ))}
                        </article>
                      ))}
                    </div>
                    {report.overlaps.length > 0 && (
                      <div>
                        <h4 className="text-13-medium">{language.t("agentTasks.overlaps")}</h4>
                        <ul>
                          {report.overlaps.map((item) => (
                            <li key={item.path} className="break-all">
                              {item.path} · {language.list(item.taskIDs)}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <section
                      aria-label={language.t("agentTasks.integration")}
                      className="flex min-w-0 flex-col gap-3 border-t border-v2-border-border-base pt-4"
                    >
                      <h4 className="text-13-medium">{language.t("agentTasks.integration")}</h4>
                      <p className="text-ink-muted">{language.t("agentTasks.integrationHelp")}</p>
                      {view.inventoryError && <p role="alert">{language.t("agentTasks.targetsUnavailable")}</p>}
                      {(task.status === "pending" || task.status === "in_progress") && (
                        <>
                          <label className="flex min-w-0 flex-col gap-1">
                            {language.t("agentTasks.target")}
                            <Select
                              aria-label={language.t("agentTasks.target")}
                              value={view.target}
                              disabled={view.busy}
                              onValueChange={services.selectTarget}
                              options={[
                                { value: "", label: language.t("agentTasks.chooseTarget") },
                                ...view.targets.map((item) => ({ value: item.directory, label: item.directory })),
                              ]}
                            />
                          </label>
                          <Button
                            variant="secondary"
                            className="self-start"
                            disabled={
                              !available ||
                              !view.target ||
                              view.inventoryError ||
                              !report.inputs.length ||
                              !report.executionSettled ||
                              !report.acceptanceReady
                            }
                            onClick={services.prepare}
                          >
                            {language.t("agentTasks.prepare")}
                          </Button>
                        </>
                      )}
                      {binding && (
                        <div className="min-w-0">
                          <p className="break-all">
                            {language.t("agentTasks.boundTarget", { directory: binding.binding.target })}
                          </p>
                          <p className="break-all font-mono">
                            {binding.binding.targetHead} → {binding.binding.head}
                          </p>
                          {!binding.contractCurrent && <p role="status">{language.t("agentTasks.changedCandidate")}</p>}
                          {binding.issues.map((issue, index) => (
                            <p key={index}>{issue}</p>
                          ))}
                          <Button
                            className="mt-2"
                            variant="secondary"
                            disabled={!available || !binding.contractCurrent}
                            onClick={services.review}
                          >
                            {language.t("agentTasks.review")}
                          </Button>
                        </div>
                      )}
                      {candidate && (
                        <div className="min-w-0">
                          <h5 className="text-13-medium">{language.t("agentTasks.candidate")}</h5>
                          <p>
                            {language.t(candidate.status === "ready" ? "agentTasks.prepared" : "agentTasks.conflicted")}
                          </p>
                          <p className="break-all">{candidate.target}</p>
                          <p className="break-all font-mono">
                            {candidate.targetHead} → {candidate.head}
                          </p>
                          {candidate.steps
                            .flatMap((step) => step.conflicts)
                            .map((path, index) => (
                              <p key={index} className="break-all">
                                {path}
                              </p>
                            ))}
                          <pre
                            aria-label={language.t("agentTasks.diff")}
                            tabIndex={0}
                            className="my-2 max-h-96 min-w-0 overflow-auto rounded border border-v2-border-border-base p-3 font-mono text-caption whitespace-pre"
                          >
                            {candidate.diff || language.t("agentWorktrees.noDiff")}
                          </pre>
                          {candidate.truncated && <p role="status">{language.t("agentTasks.truncatedDiff")}</p>}
                          {!accepted && <p>{language.t("agentTasks.verificationRequired")}</p>}
                          {accepted && !reviewed && <p>{language.t("agentTasks.reviewAgain")}</p>}
                          {accepted && reviewed && !pending && !applied && (
                            <>
                              <p>{language.t("agentTasks.applyHelp")}</p>
                              <Button
                                className="mt-2"
                                disabled={!available || view.refreshing}
                                onClick={services.apply}
                              >
                                {language.t("agentTasks.apply")}
                              </Button>
                            </>
                          )}
                        </div>
                      )}
                      {applied && <p role="status">{language.t("agentTasks.applied")}</p>}
                      {pending && (
                        <div>
                          <p role="status">{language.t("agentTasks.pendingApplication")}</p>
                          <p className="break-all font-mono">{view.request?.requestID ?? application?.requestID}</p>
                          <Button className="mt-2" variant="secondary" disabled={!available} onClick={services.retry}>
                            {language.t("agentTasks.retry")}
                          </Button>
                        </div>
                      )}
                    </section>
                  </>
                )}
              </section>
            )}
          </div>
        </>
      )}
    </div>
  )
}

const STATUSES = {
  pending: "agentTasks.status.pending",
  in_progress: "agentTasks.status.inProgress",
  blocked: "agentTasks.status.blocked",
  completed: "agentTasks.status.completed",
  cancelled: "agentTasks.status.cancelled",
  accepted: "agentTasks.status.accepted",
  stale: "agentTasks.status.stale",
  unverified: "agentTasks.status.unverified",
  running: "agentTasks.status.running",
  settled: "agentTasks.status.settled",
  succeeded: "agentTasks.status.succeeded",
  failed: "agentTasks.status.failed",
  interrupted: "agentTasks.status.interrupted",
  unknown: "agentTasks.status.unknown",
} as const
