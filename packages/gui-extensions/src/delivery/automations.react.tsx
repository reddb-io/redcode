/** @jsxImportSource react */
import { useState } from "react"
import { Automation } from "@opencode/schema/automation"
import { TaskList } from "@reddb-io/design-system/app/TaskList"
import { Button } from "@reddb-io/design-system/base/Button"
import { CodeBlock } from "@reddb-io/design-system/base/CodeBlock"
import { DescriptionList } from "@reddb-io/design-system/base/DescriptionList"
import { Dialog } from "@reddb-io/design-system/base/Dialog"
import { Input } from "@reddb-io/design-system/base/Input"
import { Textarea } from "@reddb-io/design-system/base/Textarea"
import { Select } from "@reddb-io/design-system/base/Select"
import { Field } from "@reddb-io/design-system/base/Field"
import { Checkbox } from "@reddb-io/design-system/base/Checkbox"
import { ActivityTimeline } from "@reddb-io/design-system/data/ActivityTimeline"
import { DateTime, Option, Schema } from "effect"
import type { DeliveryAutomations } from "./automations"

export function DeliveryAutomationsView(props: {
  view: ReturnType<DeliveryAutomations["snapshot"]>
  actions: DeliveryAutomations["actions"]
  copy: Record<string, string>
}) {
  const view = props.view
  const copy = props.copy
  const [draft, setDraft] = useState<{
    id: Automation.ID
    title: string
    prompt: string
    type: "interval" | "once" | "fixed_time"
    minutes: number
    at: string
    timeOfDay: string
    timeZone: string
    weekdays: number[]
    condition: "always" | "http" | "process"
    target: string
    when: "matches" | "not_matches"
    mode: "on_match" | "on_change"
  } | null>(null)
  const [confirmation, setConfirmation] = useState<{
    type: "run" | "remove"
    id: string
    runID: Automation.RunID
  } | null>(null)
  const [invalid, setInvalid] = useState(false)
  const task = view.items.find((item) => item.id === view.selected)
  const target = view.items.find((item) => item.id === confirmation?.id)
  const disabled = !view.connected || view.unavailable || view.loading || view.pending
  const date = (at: number, timeZone?: string) =>
    new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short", timeZone }).format(at)
  const timeZone = task?.schedule.type === "fixed_time" ? task.schedule.timeZone : undefined
  const firstAdmission = Math.min(...view.history.map((run) => run.scheduledAt))
  const lastAdmission = Math.max(...view.history.map((run) => run.scheduledAt))
  const admissionPadding = Math.max(1000, (lastAdmission - firstAdmission) * 0.05)
  return (
    <div className="flex min-w-0 flex-col gap-[var(--reddb-spatial-layout-gap-md)]">
      <p className="m-0 text-caption text-ink-muted">{copy.autoNote}</p>
      {(!view.connected || view.unavailable) && (
        <p role="alert" className="m-0 text-caption text-feedback-warning-foreground">
          {view.connected ? copy.autoUnavailable : copy.autoDisconnected}
        </p>
      )}
      {view.loading && view.connected && !view.unavailable && <p role="status">{copy.autoLoading}</p>}
      {view.failed && !draft && !confirmation && <p role="alert">{copy.autoFailed}</p>}
      <Button
        variant="secondary"
        disabled={disabled}
        onClick={() => {
          props.actions.clear()
          setInvalid(false)
          const now = new Date(Date.now() + 600000)
          setDraft({
            id: Automation.ID.create(),
            title: "",
            prompt: "",
            type: "interval",
            minutes: 10,
            at: new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16),
            timeOfDay: "09:00",
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            weekdays: [1, 2, 3, 4, 5, 6, 7],
            condition: "always",
            target: "",
            when: "matches",
            mode: "on_match",
          })
        }}
      >
        {copy.autoCreate}
      </Button>
      {!view.loading && (
        <TaskList
          label={copy.automations}
          emptyLabel={view.unavailable || !view.connected ? copy.autoUnknown : copy.autoEmpty}
          items={view.items.map((item) => ({
            id: item.id,
            title: item.title,
            state: item.enabled ? "queued" : "paused",
            stateLabel: item.enabled ? copy.autoEnabled : copy.autoInactive,
            description: item.scheduleLabel,
          }))}
          actions={(item) => (
            <Button
              size="sm"
              variant="ghost"
              aria-pressed={view.selected === item.id}
              onClick={() => props.actions.select(item.id)}
            >
              {copy.autoInspect}
            </Button>
          )}
        />
      )}
      {task && (
        <section aria-label={copy.autoDetails} className="min-w-0 rounded-lg border border-elevation-raised-border p-3">
          <h3 className="m-0 text-body font-medium">{task.title}</h3>
          <DescriptionList
            className="my-3 [&_dd]:break-words"
            items={[
              { term: copy.autoSchedule, detail: task.scheduleLabel },
              ...(task.condition
                ? [
                    {
                      term: copy.autoCondition,
                      detail: `${task.condition.probe.type === "http" ? task.condition.probe.url : (task.condition.probe.name ?? String(task.condition.probe.pid))} · ${task.condition.when === "matches" ? copy.autoConditionMatches : copy.autoConditionNotMatches}`,
                    },
                    {
                      term: copy.autoConditionFrequency,
                      detail:
                        task.condition.mode === "on_change"
                          ? copy.autoConditionTransition
                          : copy.autoConditionEveryMatch,
                    },
                  ]
                : []),
              {
                term: copy.autoNext,
                detail: task.enabled && task.nextAt !== null ? date(task.nextAt, timeZone) : copy.autoNoNext,
              },
              ...(timeZone ? [{ term: copy.autoZone, detail: timeZone }] : []),
              { term: copy.autoCreated, detail: date(task.created) },
            ]}
          />
          {timeZone && <p className="text-caption text-ink-muted">{copy.autoCalendarPolicy}</p>}
          <CodeBlock
            code={task.prompt}
            regionLabel={copy.autoPrompt}
            copyLabel={copy.autoCopy}
            copiedLabel={copy.autoCopied}
            copyErrorLabel={copy.autoCopyFailed}
          />
          <div className="my-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={disabled || (!task.enabled && task.schedule.type === "once" && task.nextAt === null)}
              onClick={() => {
                void props.actions
                  .change({ type: "control", id: task.id, enabled: !task.enabled })
                  .catch(() => undefined)
              }}
            >
              {task.enabled ? copy.autoPause : copy.autoResume}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={disabled}
              onClick={() => {
                props.actions.clear()
                setConfirmation({ type: "run", id: task.id, runID: Automation.RunID.create() })
              }}
            >
              {copy.autoRun}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => {
                props.actions.clear()
                setConfirmation({ type: "remove", id: task.id, runID: Automation.RunID.create() })
              }}
            >
              {copy.autoRemove}
            </Button>
          </div>
          <p className="m-0 text-caption text-ink-muted">{copy.autoPauseNote}</p>
          <h4 className="mb-2 text-eyebrow text-ink-muted">{copy.autoHistory}</h4>
          {view.historyFailed && <p role="alert">{copy.autoHistoryFailed}</p>}
          {/* The list below owns accessible run details; the compact timeline is a decorative overview. */}
          {!view.historyFailed &&
            !view.historyLoading &&
            view.connected &&
            !view.unavailable &&
            view.history.length > 1 && (
              <div aria-hidden="true" inert className="mb-3 [&_button]:hidden [&_ol]:min-w-0">
                <ActivityTimeline
                  label={copy.autoHistory}
                  endLabel={copy.autoHistory}
                  className="[&_[data-activity-event]]:!w-1 [&_[data-activity-event]]:rounded-full [&_[data-activity-track]]:rounded-full [&_[data-activity-track]]:bg-elevation-sunken-surface"
                  domain={[firstAdmission - admissionPadding, lastAdmission + admissionPadding]}
                  rows={[
                    {
                      id: task.id,
                      label: task.title,
                      summary: date(firstAdmission, timeZone),
                      detail: date(lastAdmission, timeZone),
                      events: view.history.map((run) => ({
                        id: run.id,
                        label: copy[`autoStatus.${run.status}`],
                        start: run.scheduledAt,
                        end: run.scheduledAt,
                        series: run.status === "failed" ? 4 : run.status === "admitted" ? 1 : 2,
                      })),
                    },
                  ]}
                />
              </div>
            )}
          {view.historyLoading && !view.historyFailed ? (
            <p role="status">{copy.autoHistoryLoading}</p>
          ) : (
            <TaskList
              label={copy.autoHistory}
              emptyLabel={view.historyFailed ? copy.autoUnknown : copy.autoNoHistory}
              items={view.history.map((run) => ({
                id: run.id,
                title: date(run.scheduledAt, timeZone),
                state:
                  run.status === "admitted"
                    ? "succeeded"
                    : run.status === "failed"
                      ? "failed"
                      : run.status === "skipped" || run.status === "missed"
                        ? "cancelled"
                        : "running",
                stateLabel: copy[`autoStatus.${run.status}`],
                description: copy[`autoTrigger.${run.trigger}`],
                reason:
                  run.delivery === "uncertain"
                    ? [copy.autoDeliveryUncertain, run.error].filter(Boolean).join(" ")
                    : (run.error ?? undefined),
              }))}
              actions={(item) => {
                const run = view.history.find((candidate) => candidate.id === item.id)
                if (run?.delivery !== "uncertain") return null
                return (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={disabled}
                    onClick={() => {
                      props.actions.clear()
                      setConfirmation({ type: "run", id: task.id, runID: Automation.RunID.create() })
                    }}
                  >
                    {copy.autoRetryAnyway}
                  </Button>
                )
              }}
            />
          )}
        </section>
      )}
      <Dialog
        open={!!draft}
        title={copy.autoCreate}
        description={copy.autoCreateNote}
        dismissible={!view.pending}
        showClose={false}
        header={({ close }) => (
          <div className="flex items-center justify-between gap-3">
            <h3 className="m-0 text-heading">{copy.autoCreate}</h3>
            <Button variant="ghost" disabled={view.pending} onClick={close} aria-label={copy.autoClose}>
              ×
            </Button>
          </div>
        )}
        actions={() => (
          <div className="flex flex-col gap-2">
            {invalid && (
              <p role="alert">{draft?.type === "fixed_time" ? copy.autoCalendarInvalid : copy.autoInvalid}</p>
            )}
            {view.failed && <p role="alert">{copy.autoFailed}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" disabled={view.pending} onClick={() => setDraft(null)}>
                {copy.autoCancel}
              </Button>
              <Button type="submit" form={draft?.id} disabled={disabled || !draft}>
                {view.pending ? copy.autoApplying : copy.autoCreate}
              </Button>
            </div>
          </div>
        )}
        onOpenChange={(open) => {
          if (!open && !view.pending) setDraft(null)
        }}
      >
        {draft && (
          <form
            id={draft.id}
            className="flex min-w-0 flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              const at = new Date(draft.at).getTime()
              const condition =
                draft.condition === "always"
                  ? undefined
                  : draft.condition === "http"
                    ? { probe: { type: "http" as const, url: draft.target.trim() }, when: draft.when, mode: draft.mode }
                    : {
                        probe: { type: "process" as const, name: draft.target.trim(), state: "running" as const },
                        when: draft.when,
                        mode: draft.mode,
                      }
              let validTarget = true
              if (condition?.probe.type === "http") {
                try {
                  const url = new URL(condition.probe.url)
                  validTarget =
                    (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password
                } catch {
                  validTarget = false
                }
              }
              const schedule = Schema.decodeUnknownOption(Automation.Schedule)(
                draft.type === "once"
                  ? { type: "once", at }
                  : draft.type === "interval"
                    ? { type: "interval", everyMs: draft.minutes * 60000 }
                    : {
                        type: "fixed_time",
                        timeOfDay: draft.timeOfDay,
                        timeZone: draft.timeZone,
                        weekdays: draft.weekdays,
                      },
              )
              if (
                disabled ||
                !draft.title.trim() ||
                !draft.prompt.trim() ||
                !validTarget ||
                (draft.condition !== "always" && !draft.target.trim()) ||
                Option.isNone(schedule) ||
                (draft.type === "fixed_time" && Option.isNone(DateTime.zoneMakeNamed(draft.timeZone))) ||
                (draft.type === "once" && at <= Date.now()) ||
                (draft.type === "interval" && !Number.isInteger(draft.minutes))
              ) {
                setInvalid(true)
                return
              }
              setInvalid(false)
              void props.actions
                .change({
                  type: "create",
                  input: {
                    id: draft.id,
                    title: draft.title,
                    prompt: draft.prompt,
                    schedule: schedule.value,
                    ...(condition ? { condition } : {}),
                  },
                })
                .then(
                  () => setDraft(null),
                  () => undefined,
                )
            }}
          >
            <Field label={copy.autoTitle}>
              {(control) => (
                <Input
                  {...control}
                  required
                  maxLength={160}
                  disabled={view.pending}
                  value={draft.title}
                  onValueChange={(title) => setDraft({ ...draft, title })}
                />
              )}
            </Field>
            <Field label={copy.autoPrompt}>
              {(control) => (
                <Textarea
                  {...control}
                  required
                  maxLength={16000}
                  rows={5}
                  disabled={view.pending}
                  value={draft.prompt}
                  onValueChange={(prompt) => setDraft({ ...draft, prompt })}
                />
              )}
            </Field>
            <Field label={copy.autoSchedule}>
              {(control) => (
                <Select
                  {...control}
                  disabled={view.pending}
                  value={draft.type}
                  options={[
                    { value: "interval", label: copy.autoInterval },
                    { value: "once", label: copy.autoOnce },
                    { value: "fixed_time", label: copy.autoCalendar },
                  ]}
                  onValueChange={(value) => {
                    if (value === "interval" || value === "once" || value === "fixed_time")
                      setDraft({ ...draft, type: value })
                  }}
                />
              )}
            </Field>
            <Field label={copy.autoCondition}>
              {(control) => (
                <Select
                  {...control}
                  disabled={view.pending}
                  value={draft.condition}
                  options={[
                    { value: "always", label: copy.autoConditionAlways },
                    { value: "http", label: copy.autoConditionHttp },
                    { value: "process", label: copy.autoConditionProcess },
                  ]}
                  onValueChange={(value) => {
                    if (value === "always" || value === "http" || value === "process")
                      setDraft({ ...draft, condition: value, target: "" })
                  }}
                />
              )}
            </Field>
            {draft.condition !== "always" && (
              <>
                <Field label={copy.autoConditionFrequency}>
                  {(control) => (
                    <Select
                      {...control}
                      disabled={view.pending}
                      value={draft.mode}
                      options={[
                        { value: "on_match", label: copy.autoConditionEveryMatch },
                        { value: "on_change", label: copy.autoConditionTransition },
                      ]}
                      onValueChange={(mode) => {
                        if (mode === "on_match" || mode === "on_change") setDraft({ ...draft, mode })
                      }}
                    />
                  )}
                </Field>
                {draft.mode === "on_change" && (
                  <p className="m-0 text-caption text-ink-muted">{copy.autoConditionTransitionNote}</p>
                )}
                <Field label={copy.autoConditionVerdict}>
                  {(control) => (
                    <Select
                      {...control}
                      disabled={view.pending}
                      value={draft.when}
                      options={[
                        { value: "matches", label: copy.autoConditionMatches },
                        { value: "not_matches", label: copy.autoConditionNotMatches },
                      ]}
                      onValueChange={(when) => {
                        if (when === "matches" || when === "not_matches") setDraft({ ...draft, when })
                      }}
                    />
                  )}
                </Field>
                <Field label={draft.condition === "http" ? copy.autoConditionUrl : copy.autoConditionProcessName}>
                  {(control) => (
                    <Input
                      {...control}
                      required
                      disabled={view.pending}
                      value={draft.target}
                      onValueChange={(target) => setDraft({ ...draft, target })}
                    />
                  )}
                </Field>
                <p className="m-0 text-caption text-ink-muted">
                  {copy.autoConditionNote} {copy.autoConditionOldServer}
                </p>
              </>
            )}
            {draft.type === "interval" ? (
              <Field label={copy.autoMinutes}>
                {(control) => (
                  <Input
                    {...control}
                    type="number"
                    min={1}
                    max={525600}
                    step={1}
                    required
                    disabled={view.pending}
                    value={draft.minutes}
                    onValueChange={(minutes) => setDraft({ ...draft, minutes: minutes ?? 0 })}
                  />
                )}
              </Field>
            ) : draft.type === "once" ? (
              <Field label={copy.autoAt}>
                {(control) => (
                  <Input
                    {...control}
                    type="datetime-local"
                    required
                    disabled={view.pending}
                    value={draft.at}
                    onValueChange={(at) => setDraft({ ...draft, at })}
                  />
                )}
              </Field>
            ) : (
              <>
                <Field label={copy.autoTimeOfDay}>
                  {(control) => (
                    <Input
                      {...control}
                      type="time"
                      step={60}
                      required
                      disabled={view.pending}
                      value={draft.timeOfDay}
                      onValueChange={(timeOfDay) => setDraft({ ...draft, timeOfDay })}
                    />
                  )}
                </Field>
                <Field label={copy.autoZone} help={copy.autoZoneHelp}>
                  {(control) => (
                    <Input
                      {...control}
                      required
                      maxLength={100}
                      disabled={view.pending}
                      value={draft.timeZone}
                      onValueChange={(timeZone) => setDraft({ ...draft, timeZone })}
                    />
                  )}
                </Field>
                <fieldset className="m-0 min-w-0 border-0 p-0" disabled={view.pending}>
                  <legend className="mb-2 text-caption">{copy.autoWeekdays}</legend>
                  <div className="grid grid-cols-2 gap-2">
                    {[1, 2, 3, 4, 5, 6, 7].map((day) => (
                      <Checkbox
                        key={day}
                        label={copy[`autoDay.${day}`]}
                        checked={draft.weekdays.includes(day)}
                        onCheckedChange={(checked) =>
                          setDraft({
                            ...draft,
                            weekdays: checked
                              ? [...draft.weekdays, day].toSorted((a, b) => a - b)
                              : draft.weekdays.filter((value) => value !== day),
                          })
                        }
                      />
                    ))}
                  </div>
                </fieldset>
              </>
            )}
            {draft.type === "fixed_time" ? (
              <p className="m-0 text-caption text-ink-muted">{copy.autoCalendarPolicy}</p>
            ) : (
              <p className="m-0 text-caption text-ink-muted">
                {copy.autoTimezone} {Intl.DateTimeFormat().resolvedOptions().timeZone}
              </p>
            )}
          </form>
        )}
      </Dialog>
      <Dialog
        open={!!confirmation}
        title={confirmation?.type === "run" ? copy.autoRunConfirm : copy.autoRemoveConfirm}
        description={confirmation?.type === "run" ? copy.autoRunNote : copy.autoRemoveNote}
        dismissible={!view.pending}
        showClose={!view.pending}
        onOpenChange={(open) => {
          if (!open && !view.pending) setConfirmation(null)
        }}
        actions={() => (
          <>
            <Button variant="secondary" disabled={view.pending} onClick={() => setConfirmation(null)}>
              {copy.autoCancel}
            </Button>
            <Button
              disabled={disabled || !target}
              onClick={() => {
                if (!confirmation || !target || disabled) return
                void props.actions
                  .change(
                    confirmation.type === "run"
                      ? { type: "run", id: target.id, runID: confirmation.runID }
                      : { type: "remove", id: target.id },
                  )
                  .then(
                    () => setConfirmation(null),
                    () => undefined,
                  )
              }}
            >
              {view.pending ? copy.autoApplying : copy.autoConfirm}
            </Button>
          </>
        )}
      >
        {target && (
          <>
            <h3 className="text-body font-medium">{target.title}</h3>
            <p className="whitespace-pre-wrap break-words text-body">{target.prompt}</p>
          </>
        )}
        {view.failed && <p role="alert">{copy.autoFailed}</p>}
      </Dialog>
    </div>
  )
}
