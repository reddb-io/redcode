/** @jsxImportSource react */
import { useEffect, useId, useRef, useState, useSyncExternalStore, type FormEvent } from "react"
import { Badge } from "@reddb-io/design-system/base/Badge"
import { Button } from "@reddb-io/design-system/base/Button"
import { Disclosure } from "@reddb-io/design-system/base/Disclosure"
import { Field } from "@reddb-io/design-system/base/Field"
import { Input } from "@reddb-io/design-system/base/Input"
import { LoadingIndicator } from "@reddb-io/design-system/base/LoadingIndicator"
import { RadioGroup } from "@reddb-io/design-system/base/RadioGroup"
import { ListRow } from "@reddb-io/design-system/app/ListRow"
import type { FormValue } from "@opencode/client/promise"
import { Icon } from "@/runtime/react/icon.react"
import { ProviderModelIcon } from "@/settings/providers/provider-icon.react"
import type { createProviderConnectionServices } from "./dialog"

type Services = ReturnType<typeof createProviderConnectionServices>
type View = ReturnType<Services["snapshot"]["getSnapshot"]>
type AnswerField = Exclude<NonNullable<View["form"]>[number], { type: "external" | "multiselect" }>

export function ProviderConnectionView(props: { services: Services }) {
  const services = props.services
  const view = useSyncExternalStore(services.snapshot.subscribe, services.snapshot.getSnapshot)
  const language = view.language
  if (view.state.models) return <FirstConnectionModels view={view} services={services} />
  const title = view.consoleSignIn
    ? language.t("provider.connect.console.title")
    : view.provider.id === "anthropic" && view.method?.label?.toLowerCase().includes("max")
      ? language.t("provider.connect.title.anthropicProMax")
      : language.t("provider.connect.title", { provider: view.provider.name })
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <div className="flex shrink-0 items-center gap-2 px-3">
        <ProviderModelIcon provider={view.provider} className="shrink-0 text-foreground" />
        <h3 className="m-0 text-heading">{title}</h3>
      </div>
      <div
        data-component="provider-connect-content"
        className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto pb-4"
      >
        {view.remoteName && (
          <div role="note" className="mx-3 rounded-md border border-muted bg-v2-background-bg-layer-02 p-3 text-body">
            <p className="font-medium text-foreground">
              {language.t("provider.connect.remote.title", { server: view.remoteName })}
            </p>
            <p className="text-ink-muted">{language.t("provider.connect.remote.description")}</p>
          </div>
        )}
        {view.state.noModels && view.authState !== "error" ? (
          <div role="status" className="flex flex-col items-start gap-5 px-3 text-body text-ink-muted">
            <div>
              <p className="flex items-center gap-2 font-medium text-foreground">
                <Icon name="circle-check" />
                {language.t("provider.connect.console.connected")}
              </p>
              <p>
                {language.t(
                  view.state.catalogPending
                    ? "provider.connect.console.modelsLoading"
                    : "provider.connect.console.noModels",
                )}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {!view.state.catalogPending && (
                <Button onClick={services.openConsole}>{language.t("provider.connect.console.openAgain")}</Button>
              )}
              <Button
                disabled={view.authState === "refreshing"}
                aria-busy={view.authState === "refreshing"}
                onClick={() => void services.auth.refresh()}
              >
                {language.t("provider.connect.console.refresh")}
              </Button>
            </div>
          </div>
        ) : view.consoleSignIn ? (
          <ConsoleAuthorization view={view} services={services} />
        ) : view.busy ? (
          <LoadingIndicator className="mx-3" label={language.t("provider.connect.status.inProgress")} />
        ) : view.methodIndex === undefined ? (
          <div className="flex flex-col gap-2">
            <p className="m-0 px-3 text-body text-ink-muted">
              {language.t("provider.connect.selectMethod", { provider: view.provider.name })}
            </p>
            {view.methods.map((method, index) => (
              <ListRow
                key={index}
                title={method.label}
                description={method.hint}
                onClick={() => void services.auth.select(index)}
              />
            ))}
          </div>
        ) : view.authState === "form" ? (
          <AuthFormView key={view.methodIndex} view={view} services={services} />
        ) : view.authState === "error" ? (
          <div className="flex flex-col items-start gap-3 px-3">
            <p role="alert" className="m-0 flex items-start gap-2 text-body text-foreground">
              <Icon name="circle-ban-sign" className="mt-0.5 shrink-0 text-feedback-danger-foreground" />
              {view.isConsole ? view.error : language.t("provider.connect.status.failed", { error: view.error ?? "" })}
            </p>
            <Button variant="secondary" onClick={() => void services.auth.retry()}>
              {language.t("common.retry")}
            </Button>
          </div>
        ) : view.method?.type === "command" ? (
          <div className="flex flex-col gap-4 px-3 text-body text-ink-muted">
            <p className="m-0">
              {language.t("provider.connect.command.description", { provider: view.provider.name })}
            </p>
            <code className="block rounded-sm bg-foreground/5 px-2 py-1 font-mono text-caption text-foreground">
              {view.method.command.join(" ")}
            </code>
            <pre
              data-component="provider-command-output"
              aria-live="polite"
              className="max-h-60 min-h-16 overflow-auto whitespace-pre-wrap rounded-md bg-foreground/5 p-3 font-mono text-caption text-foreground"
            >
              {view.output?.trim() || language.t("provider.connect.command.starting")}
            </pre>
            <LoadingIndicator label={language.t("provider.connect.command.waiting")} />
          </div>
        ) : view.method?.type === "key" ? (
          <CredentialForm key={`key:${view.methodIndex}`} view={view} services={services} mode="key" />
        ) : view.authorization?.mode === "code" ? (
          <CredentialForm key={view.authorization.attemptID} view={view} services={services} mode="code" />
        ) : view.authorization?.mode === "auto" ? (
          <div className="flex flex-col gap-5 px-3 text-body text-ink-muted">
            <p className="m-0">
              {language.t("provider.connect.oauth.auto.description", { provider: view.provider.name })}
            </p>
            <LoadingIndicator label={language.t("provider.connect.status.waiting")} />
            <Button className="self-start" variant="secondary" onClick={() => void services.auth.open()}>
              <Icon name="arrow-up-right" />
              {language.t("provider.connect.oauth.openBrowser")}
            </Button>
            {view.code && (
              <Field
                label={language.t("provider.connect.oauth.auto.confirmationCode")}
                help={language.t("provider.connect.oauth.auto.confirmationCode.description")}
              >
                {(control) => (
                  <div className="flex items-center gap-2">
                    <Input {...control} type="text" className="w-full font-mono" readOnly value={view.code} />
                    <Button
                      variant="ghost"
                      aria-label={language.t("common.copy")}
                      onClick={() => void services.copyCode(view.code ?? "")}
                    >
                      <Icon name="copy" />
                    </Button>
                  </div>
                )}
              </Field>
            )}
          </div>
        ) : null}
        {view.isConsole &&
          !view.loading &&
          !view.state.noModels &&
          view.method?.type !== "key" &&
          view.keyIndex !== -1 && (
            <div data-component="console-service-account" className="flex flex-wrap items-center gap-1 px-3 text-body">
              <span className="text-ink-muted">{language.t("provider.connect.console.serviceAccount")}</span>
              <Button
                variant="ghost"
                size="sm"
                data-action="provider-connect-api-key"
                onClick={() => void services.auth.select(view.keyIndex)}
              >
                {language.t("provider.connect.console.useApiKey")}
              </Button>
            </div>
          )}
      </div>
    </div>
  )
}

function ConsoleAuthorization(props: { view: View; services: Services }) {
  const view = props.view
  const language = view.language
  return (
    <div data-component="console-authorization" className="flex flex-col gap-5 px-3 text-body text-ink-muted">
      <p className="m-0">
        {language.t(
          view.browserFailed ? "provider.connect.console.browserFailed" : "provider.connect.console.instructions",
        )}
      </p>
      <div className="flex flex-col gap-2">
        <div className="font-medium text-foreground">{language.t("provider.connect.console.deviceCode")}</div>
        {view.code ? (
          <>
            <div
              dir="ltr"
              role="group"
              aria-label={language.t("provider.connect.console.deviceCode.label", { code: view.code })}
              className="flex max-w-full gap-1 self-start font-mono text-xl font-medium text-foreground tabular-nums"
            >
              {view.code.split("").map((character, index) => (
                <span
                  key={index}
                  aria-hidden="true"
                  className={
                    character === "-"
                      ? "mx-1 flex h-12 items-center text-ink-muted"
                      : "flex h-12 w-8 items-center justify-center rounded-md border border-muted bg-v2-background-bg-layer-02"
                  }
                >
                  {character}
                </span>
              ))}
            </div>
            <LoadingIndicator label={language.t("provider.connect.console.waiting")} />
          </>
        ) : (
          <LoadingIndicator className="min-h-12" label={language.t("provider.connect.console.openingBrowser")} />
        )}
      </div>
      <div data-component="console-browser-fallback" className="flex min-h-7 flex-wrap items-center gap-x-3 gap-y-1">
        <span>{language.t("provider.connect.console.browserHint")}</span>
        <Button variant="ghost" disabled={!view.code} onClick={props.services.copyLink}>
          {language.t(view.state.copied ? "provider.connect.console.linkCopied" : "provider.connect.console.copyLink")}
        </Button>
        {(view.browserFailed || view.state.copyFailed) && (
          <Button variant="ghost" onClick={() => void props.services.auth.open()}>
            {language.t("provider.connect.console.openAgain")}
          </Button>
        )}
      </div>
      {view.state.copyFailed && <p role="alert">{language.t("provider.connect.console.copyFailed")}</p>}
    </div>
  )
}

function CredentialForm(props: { view: View; services: Services; mode: "key" | "code" }) {
  const view = props.view
  const language = view.language
  const [value, setValue] = useState("")
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const isKey = props.mode === "key"
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    if (!value.trim()) {
      setError(language.t(isKey ? "provider.connect.apiKey.required" : "provider.connect.oauth.code.required"))
      return
    }
    setError(undefined)
    setBusy(true)
    if (isKey)
      await props.services.auth.connectKey(value).catch((error: unknown) => setError(props.services.keyError(error)))
    if (!isKey) setError(await props.services.auth.completeCode(value))
    setBusy(false)
  }
  return (
    <div className="flex flex-col gap-5 px-3 text-body text-ink-muted">
      <div>
        {isKey ? (
          view.isConsole ? (
            <>
              {language.t("provider.connect.console.apiKey.description")}{" "}
              <a
                className="text-foreground underline"
                href="https://opencode.ai/console"
                target="_blank"
                rel="noopener noreferrer"
              >
                {language.t("provider.connect.console.apiKey.link")}
              </a>
            </>
          ) : (
            language.t("provider.connect.apiKey.description", { provider: view.provider.name })
          )
        ) : (
          language.t("provider.connect.oauth.code.description", { provider: view.provider.name })
        )}
      </div>
      {!isKey && (
        <Button className="self-start" variant="secondary" onClick={() => void props.services.auth.open()}>
          <Icon name="arrow-up-right" />
          {language.t("provider.connect.oauth.openBrowser")}
        </Button>
      )}
      <form onSubmit={(event) => void submit(event)} className="flex flex-col items-start gap-5 self-stretch">
        <Field
          className="w-full"
          label={
            isKey
              ? language.t("provider.connect.apiKey.label", { provider: view.provider.name })
              : language.t("provider.connect.oauth.code.label", { method: view.method?.label ?? "" })
          }
          error={error}
        >
          {(control) => (
            <Input
              {...control}
              type="text"
              autoFocus
              className="w-full"
              name={isKey ? "apiKey" : "code"}
              data-input={isKey ? "provider-api-key" : undefined}
              placeholder={language.t(
                isKey ? "provider.connect.apiKey.placeholder" : "provider.connect.oauth.code.placeholder",
              )}
              value={value}
              autoComplete="off"
              spellCheck={false}
              onValueChange={setValue}
            />
          )}
        </Field>
        <Button
          type="submit"
          variant="primary"
          disabled={busy}
          aria-busy={busy}
          data-action={isKey ? "provider-connect-submit" : undefined}
        >
          {language.t("common.continue")}
        </Button>
      </form>
    </div>
  )
}

// Keep answers local to this attempt; the existing controller owns submission and cancellation.
function AuthFormView(props: { view: View; services: Services }) {
  const language = props.view.language
  const form = props.view.form ?? []
  const [state, setState] = useState(() => ({
    value: Object.fromEntries(
      form.flatMap((field) =>
        field.type !== "external" && field.key in props.view.defaults && field.default !== undefined
          ? [[field.key, field.default]]
          : [],
      ),
    ) as Record<string, FormValue>,
    index: 0,
    customOn: false,
    customText: "",
    error: undefined as string | undefined,
  }))
  const name = useId()
  const fields = form.flatMap<AnswerField>((field) =>
    field.type !== "external" && field.type !== "multiselect" && !field.hidden ? [field] : [],
  )
  const matches = (field: AnswerField, value: Record<string, FormValue>) =>
    (field.when ?? []).every((condition) => {
      const actual = value[condition.key]
      return actual !== undefined && (condition.op === "eq" ? actual === condition.value : actual !== condition.value)
    })
  const index = fields.findIndex((field, index) => index >= state.index && matches(field, state.value))
  const field = fields[index]
  if (!field) return null
  const answer = state.value[field.key] ?? field.default
  const custom =
    field.type === "string" &&
    field.custom &&
    (state.customOn || (answer !== undefined && !field.options?.some((option) => option.value === answer)))
  const next = (value: Record<string, FormValue>) => {
    const next = fields.findIndex((field, i) => i > index && matches(field, value))
    if (next !== -1) {
      setState({ value, index: next, customOn: false, customText: "", error: undefined })
      return
    }
    if (props.view.methodIndex !== undefined) void props.services.auth.select(props.view.methodIndex, value)
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const number = field.type === "number" || field.type === "integer"
    const value = !number ? answer : String(answer ?? "").trim() === "" ? undefined : Number(answer)
    const error =
      value === undefined || value === ""
        ? field.required
          ? language.t("provider.connect.form.required")
          : undefined
        : number &&
            (typeof value !== "number" ||
              !Number.isFinite(value) ||
              (field.type === "integer" && !Number.isInteger(value)))
          ? language.t(field.type === "integer" ? "provider.connect.form.integer" : "provider.connect.form.number")
          : undefined
    if (error) {
      setState({ ...state, error })
      return
    }
    const answered = { ...state.value }
    if (value === undefined) delete answered[field.key]
    if (value !== undefined) answered[field.key] = value
    next(answered)
  }
  const choose = (value: FormValue) => next({ ...state.value, [field.key]: value })
  return (
    <form onSubmit={submit} className="flex flex-col items-start gap-4 px-3" key={field.key}>
      {field.type === "boolean" ? (
        <AnswerChoices
          title={field.title ?? field.key}
          description={field.description}
          value={answer}
          options={(field.default === false ? [false, true] : [true, false]).map((value) => ({
            value,
            label: language.t(value ? "provider.connect.form.yes" : "provider.connect.form.no"),
          }))}
          choose={choose}
        />
      ) : field.type === "string" && field.options ? (
        field.custom ? (
          <>
            <RadioGroup
              className="w-full"
              name={name}
              legend={field.title ?? field.key}
              help={field.description}
              error={state.error}
              value={custom ? "custom" : String(field.options.findIndex((option) => option.value === answer))}
              options={[
                ...field.options.map((option, index) => ({ ...option, value: String(index) })),
                { value: "custom", label: language.t("ui.messagePart.option.typeOwnAnswer") },
              ]}
              onValueChange={(value) => {
                const option = field.options?.[Number(value)]
                setState({
                  ...state,
                  customOn: !option,
                  customText: custom ? String(answer ?? "") : state.customText,
                  value: { ...state.value, [field.key]: option?.value ?? state.customText },
                  error: undefined,
                })
              }}
            />
            {custom && (
              <Field className="w-full" label={language.t("ui.messagePart.option.typeOwnAnswer")}>
                {(control) => (
                  <Input
                    {...control}
                    type="text"
                    autoFocus
                    className="w-full"
                    value={String(answer ?? "")}
                    placeholder={field.placeholder ?? language.t("ui.question.custom.placeholder")}
                    onValueChange={(value) =>
                      setState({ ...state, value: { ...state.value, [field.key]: value }, error: undefined })
                    }
                  />
                )}
              </Field>
            )}
            <Button type="submit" variant="primary">
              {language.t("common.continue")}
            </Button>
          </>
        ) : (
          <AnswerChoices
            title={field.title ?? field.key}
            description={field.description}
            value={answer}
            options={field.options}
            choose={choose}
          />
        )
      ) : (
        <>
          <Field className="w-full" label={field.title ?? field.key} help={field.description} error={state.error}>
            {(control) => (
              <Input
                {...control}
                type="text"
                autoFocus
                className="w-full"
                placeholder={field.type === "string" ? field.placeholder : undefined}
                inputMode={field.type === "string" ? undefined : "decimal"}
                value={String(answer ?? "")}
                onValueChange={(value) =>
                  setState({ ...state, value: { ...state.value, [field.key]: value }, error: undefined })
                }
              />
            )}
          </Field>
          <Button type="submit" variant="primary">
            {language.t("common.continue")}
          </Button>
        </>
      )}
    </form>
  )
}

function AnswerChoices(props: {
  title: string
  description?: string
  value: FormValue | undefined
  options: { value: FormValue; label: string; description?: string }[]
  choose: (value: FormValue) => void
}) {
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
    ;(buttons.find((button) => button.getAttribute("aria-pressed") === "true") ?? buttons[0])?.focus()
  }, [])
  return (
    <div
      ref={list}
      className="flex w-full flex-col gap-2"
      onKeyDown={(event) => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button")]
        const index = buttons.findIndex((button) => button === event.target)
        const direction = event.key === "ArrowDown" ? 1 : -1
        buttons[(index + direction + buttons.length) % buttons.length]?.focus()
        event.preventDefault()
      }}
    >
      <h4 className="m-0 text-body font-medium">{props.title}</h4>
      {props.description && <p className="m-0 text-caption text-ink-muted">{props.description}</p>}
      {props.options.map((option) => (
        <ListRow
          key={String(option.value)}
          selected={option.value === props.value}
          aria-pressed={option.value === props.value}
          title={option.label}
          description={option.description}
          onClick={() => props.choose(option.value)}
        />
      ))}
    </div>
  )
}

function FirstConnectionModels(props: { view: View; services: Services }) {
  const view = props.view
  const language = view.language
  return (
    <div data-component="first-provider-models" className="flex min-h-0 flex-1 flex-col gap-4 px-3">
      <p className="m-0 shrink-0 text-body text-ink-muted">{language.t("provider.connect.models.description")}</p>
      <div data-component="first-provider-model-scroll" className="min-h-0 flex-1 overflow-y-auto pb-4">
        <div data-component="available-models-heading" className="mb-3 flex items-center gap-2 text-body font-medium">
          {language.t("provider.connect.models.available")}
          {view.managed && <Badge>{view.managed.workspace}</Badge>}
        </div>
        <div
          role="radiogroup"
          aria-label={language.t("provider.connect.models.list", { provider: view.provider.name })}
          className="flex flex-col gap-3"
        >
          {view.groups.map((group) => {
            const list = (
              <RadioGroup
                name={`${view.provider.id}-first-model`}
                legend={group.provider.name}
                className="[&_legend]:sr-only"
                value={view.state.selectedModel}
                onValueChange={(selectedModel) => props.services.update({ selectedModel })}
                options={group.models.map((model) => ({ value: `${model.providerID}:${model.id}`, label: model.name }))}
              />
            )
            if (view.groups.length === 1 && !view.managed) return <div key={group.provider.id}>{list}</div>
            return (
              <Disclosure
                key={group.provider.id}
                label={group.provider.name}
                open={!view.state.collapsed[group.provider.id]}
                onOpenChange={(open) =>
                  props.services.update({ collapsed: { ...view.state.collapsed, [group.provider.id]: !open } })
                }
              >
                {list}
              </Disclosure>
            )
          })}
        </div>
      </div>
      <div
        data-component="first-provider-model-footer"
        className="flex shrink-0 items-center justify-end border-t border-muted py-3"
      >
        <Button
          variant="primary"
          disabled={
            !view.state.selectedModel ||
            !view.groups.some((group) =>
              group.models.some((model) => `${model.providerID}:${model.id}` === view.state.selectedModel),
            )
          }
          onClick={props.services.startWithModel}
        >
          {language.t("common.continue")}
        </Button>
      </div>
    </div>
  )
}
