/** @jsxImportSource react */
import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react"
import type { FormAnswer, FormValue } from "@opencode/client/promise"
import { Button } from "@reddb-io/design-system/base/Button"
import { Checkbox } from "@reddb-io/design-system/base/Checkbox"
import { Field } from "@reddb-io/design-system/base/Field"
import { Input } from "@reddb-io/design-system/base/Input"
import { Select } from "@reddb-io/design-system/base/Select"
import type { createSessionMcpServices } from "./session-mcp-dock"

export function SessionMcpDockView(props: { services: ReturnType<typeof createSessionMcpServices> }) {
  const services = props.services
  const view = useSyncExternalStore(services.snapshot.subscribe, services.snapshot.getSnapshot)
  const [answer, setAnswer] = useState<FormAnswer>(
    () =>
      view.draft ??
      Object.fromEntries(
        view.fields.flatMap((field) => {
          if (field.type === "external") return []
          if (field.default !== undefined) return [[field.key, field.default]]
          return field.type === "boolean" && field.required ? [[field.key, false]] : []
        }),
      ),
  )
  const form = useRef<HTMLFormElement>(null)
  useLayoutEffect(() => {
    services.save(answer)
  }, [answer, services])
  const id = useId()
  useEffect(() => {
    form.current?.querySelector<HTMLElement>("input, select, button")?.focus()
  }, [])
  const update = (key: string, value: FormValue | undefined) =>
    setAnswer((previous) => {
      const next = { ...previous }
      if (value === undefined) delete next[key]
      if (value !== undefined) next[key] = value
      return next
    })
  return (
    <form
      ref={form}
      data-component="session-mcp-dock"
      aria-labelledby={`${id}-title`}
      aria-busy={view.sending}
      className="w-full overflow-hidden rounded-lg border border-muted bg-v2-background-bg-layer-02 text-body"
      onSubmit={(event) => {
        event.preventDefault()
        void services.reply(answer)
      }}
      onKeyDown={(event) => {
        if (event.defaultPrevented || event.target instanceof HTMLSelectElement) return
        if (event.key === "Escape") {
          event.preventDefault()
          void services.cancel()
        }
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault()
          form.current?.requestSubmit()
        }
      }}
    >
      <div className="flex max-h-80 min-w-0 flex-col gap-4 overflow-y-auto p-4">
        <div>
          <h3 id={`${id}-title`} className="m-0 font-medium text-foreground">
            {view.title}
          </h3>
          {view.message && <p className="mt-1 whitespace-pre-wrap break-words text-ink-muted">{view.message}</p>}
        </div>
        <fieldset disabled={view.sending} className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
          {view.fields.map((field) => {
            const value = answer[field.key]
            if (field.type === "external")
              return (
                <div key={field.key} className="flex min-w-0 flex-col items-start gap-2">
                  {field.description && <p className="text-ink-muted">{field.description}</p>}
                  <span className="max-w-full break-all text-ink-muted">{field.url}</span>
                  <Button type="button" onClick={() => services.open(field.url)}>
                    {view.language.t("session.mcp.open")}
                  </Button>
                  <Checkbox
                    label={view.language.t("session.mcp.completed")}
                    required
                    checked={value === true}
                    onCheckedChange={(value) => update(field.key, value)}
                  />
                </div>
              )
            if (field.type === "boolean")
              return (
                <Checkbox
                  key={field.key}
                  label={field.title ?? field.key}
                  help={field.description}
                  checked={value === true}
                  onCheckedChange={(value) => update(field.key, value)}
                />
              )
            return (
              <Field
                key={field.key}
                label={field.title ?? field.key}
                help={field.description}
                required={field.required}
                className="min-w-0"
              >
                {(control) =>
                  field.type === "multiselect" ? (
                    <Select
                      {...control}
                      multiple
                      options={field.options}
                      value={Array.isArray(value) ? value : []}
                      onChange={(event) =>
                        update(
                          field.key,
                          Array.from(event.currentTarget.selectedOptions, (option) => option.value),
                        )
                      }
                    />
                  ) : field.type === "string" && field.options ? (
                    <Select
                      {...control}
                      value={String(value ?? "")}
                      onValueChange={(value) => update(field.key, value)}
                    >
                      <option value="">{view.language.t("session.mcp.choose")}</option>
                      {field.options.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                  ) : field.type === "string" ? (
                    <Input
                      {...control}
                      type={
                        field.format === "email"
                          ? "email"
                          : field.format === "uri"
                            ? "url"
                            : field.format === "date"
                              ? "date"
                              : "text"
                      }
                      value={String(value ?? "")}
                      placeholder={field.placeholder}
                      minLength={field.minLength}
                      maxLength={field.maxLength}
                      pattern={field.pattern}
                      onValueChange={(value) => update(field.key, value === "" && !field.required ? undefined : value)}
                    />
                  ) : (
                    <Input
                      {...control}
                      type="number"
                      value={typeof value === "number" ? value : null}
                      step={field.type === "integer" ? 1 : "any"}
                      min={field.minimum}
                      max={field.maximum}
                      onValueChange={(value) => update(field.key, value ?? undefined)}
                    />
                  )
                }
              </Field>
            )
          })}
        </fieldset>
      </div>
      {view.failed && (
        <p role="alert" className="px-4 pb-3 text-foreground">
          {view.language.t("session.mcp.failed")}
        </p>
      )}
      <div className="flex justify-end gap-2 border-t border-muted px-4 py-3">
        <Button type="button" variant="ghost" size="sm" disabled={view.sending} onClick={() => void services.cancel()}>
          {view.language.t("common.cancel")}
        </Button>
        <Button type="submit" variant="primary" size="sm" disabled={view.sending}>
          {view.language.t("common.submit")}
        </Button>
      </div>
    </form>
  )
}
