import { TextField } from "@reddb-io/redcode-ui/text-field"
import * as Sentry from "@sentry/solid"
import { Logo } from "@reddb-io/redcode-ui/logo"
import { Button } from "@reddb-io/redcode-ui/button"
import { Component, createSignal, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { usePlatform } from "@/context/platform"
import { Icon } from "@reddb-io/redcode-ui/icon"
import { errorDescriptionKey } from "./error-description"

export type InitError = {
  name: string
  data: Record<string, unknown>
}

const CHAIN_SEPARATOR = "\n" + "─".repeat(40) + "\n"

function isIssue(value: unknown): value is { message: string; path: string[] } {
  if (!value || typeof value !== "object") return false
  if (!("message" in value) || !("path" in value)) return false
  const message = (value as { message: unknown }).message
  const path = (value as { path: unknown }).path
  if (typeof message !== "string") return false
  if (!Array.isArray(path)) return false
  return path.every((part) => typeof part === "string")
}

function isInitError(error: unknown): error is InitError {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    "data" in error &&
    typeof (error as InitError).data === "object"
  )
}

function safeJson(value: unknown, circular: string): string {
  const seen = new WeakSet<object>()
  const json = JSON.stringify(
    value,
    (_key, val) => {
      if (typeof val === "bigint") return val.toString()
      if (typeof val === "object" && val) {
        if (seen.has(val)) return circular
        seen.add(val)
      }
      return val
    },
    2,
  )
  return json ?? String(value)
}

function formatInitError(error: InitError): string {
  const data = error.data
  const json = (value: unknown) => safeJson(value, "[Circular]")
  switch (error.name) {
    case "MCPFailed": {
      const name = typeof data.name === "string" ? data.name : ""
      return `MCP server "${name}" failed. Note, Redcode does not support MCP authentication yet.`
    }
    case "ProviderAuthError": {
      const providerID = typeof data.providerID === "string" ? data.providerID : "unknown"
      const message = typeof data.message === "string" ? data.message : json(data.message)
      return `Provider authentication failed (${providerID}): ${message}`
    }
    case "APIError": {
      const message = typeof data.message === "string" ? data.message : "API error"
      const lines: string[] = [message]

      if (typeof data.statusCode === "number") {
        lines.push(`Status: ${data.statusCode}`)
      }

      if (typeof data.isRetryable === "boolean") {
        lines.push(`Retryable: ${data.isRetryable}`)
      }

      if (typeof data.responseBody === "string" && data.responseBody) {
        lines.push(`Response body:\n${data.responseBody}`)
      }

      return lines.join("\n")
    }
    case "ProviderModelNotFoundError": {
      const { providerID, modelID, suggestions } = data as {
        providerID: string
        modelID: string
        suggestions?: string[]
      }

      const suggestionsLine =
        Array.isArray(suggestions) && suggestions.length
          ? [`Did you mean: ${suggestions.join(", ")}`]
          : []

      return [
        `Model not found: ${providerID}/${modelID}`,
        ...suggestionsLine,
        "Check your config (opencode.json) provider/model names",
      ].join("\n")
    }
    case "ProviderInitError": {
      const providerID = typeof data.providerID === "string" ? data.providerID : "unknown"
      return `Failed to initialize provider "${providerID}". Check credentials and configuration.`
    }
    case "ConfigJsonError": {
      const path = typeof data.path === "string" ? data.path : json(data.path)
      const message = typeof data.message === "string" ? data.message : ""
      if (message) return `Config file at ${path} is not valid JSON(C): ${message}`
      return `Config file at ${path} is not valid JSON(C)`
    }
    case "ConfigDirectoryTypoError": {
      const path = typeof data.path === "string" ? data.path : json(data.path)
      const dir = typeof data.dir === "string" ? data.dir : json(data.dir)
      const suggestion = typeof data.suggestion === "string" ? data.suggestion : json(data.suggestion)
      return `Directory "${dir}" in ${path} is not valid. Rename the directory to "${suggestion}" or remove it. This is a common typo.`
    }
    case "ConfigFrontmatterError": {
      const path = typeof data.path === "string" ? data.path : json(data.path)
      const message = typeof data.message === "string" ? data.message : json(data.message)
      return `Failed to parse frontmatter in ${path}:\n${message}`
    }
    case "ConfigInvalidError": {
      const issues = Array.isArray(data.issues)
        ? data.issues.filter(isIssue).map((issue) => "↳ " + issue.message + " " + issue.path.join("."))
        : []
      const message = typeof data.message === "string" ? data.message : ""
      const path = typeof data.path === "string" ? data.path : json(data.path)

      const line = message
        ? `Config file at ${path} is invalid: ${message}`
        : `Config file at ${path} is invalid`

      return [line, ...issues].join("\n")
    }
    case "UnknownError":
      return typeof data.message === "string" ? data.message : json(data)
    default:
      if (typeof data.message === "string") return data.message
      return json(data)
  }
}

function formatErrorChain(error: unknown, depth = 0, parentMessage?: string): string {
  const json = (value: unknown) => safeJson(value, "[Circular]")
  if (!error) return "Unknown error"

  if (isInitError(error)) {
    const message = formatInitError(error)
    if (depth > 0 && parentMessage === message) return ""
    const indent = depth > 0 ? `\n${CHAIN_SEPARATOR}Caused by:\n` : ""
    return indent + `${error.name}\n${message}`
  }

  if (error instanceof Error) {
    const isDuplicate = depth > 0 && parentMessage === error.message
    const parts: string[] = []
    const indent = depth > 0 ? `\n${CHAIN_SEPARATOR}Caused by:\n` : ""

    const header = `${error.name}${error.message ? `: ${error.message}` : ""}`
    const stack = error.stack?.trim()

    if (stack) {
      const startsWithHeader = stack.startsWith(header)

      if (isDuplicate && startsWithHeader) {
        const trace = stack.split("\n").slice(1).join("\n").trim()
        if (trace) {
          parts.push(indent + trace)
        }
      }

      if (isDuplicate && !startsWithHeader) {
        parts.push(indent + stack)
      }

      if (!isDuplicate && startsWithHeader) {
        parts.push(indent + stack)
      }

      if (!isDuplicate && !startsWithHeader) {
        parts.push(indent + `${header}\n${stack}`)
      }
    }

    if (!stack && !isDuplicate) {
      parts.push(indent + header)
    }

    if (error.cause) {
      const causeResult = formatErrorChain(error.cause, t, depth + 1, error.message)
      if (causeResult) {
        parts.push(causeResult)
      }
    }

    return parts.join("\n\n")
  }

  if (typeof error === "string") {
    if (depth > 0 && parentMessage === error) return ""
    const indent = depth > 0 ? `\n${CHAIN_SEPARATOR}Caused by:\n` : ""
    return indent + error
  }

  const indent = depth > 0 ? `\n${CHAIN_SEPARATOR}Caused by:\n` : ""
  return indent + json(error)
}

function formatError(error: unknown): string {
  return formatErrorChain(error, 0)
}

interface ErrorPageProps {
  error: unknown
}

export const ErrorPage: Component<ErrorPageProps> = (props) => {
  const platform = usePlatform()
  const formattedError = () => formatError(props.error)
  let recordedFatalError: Promise<void> | undefined
  const [store, setStore] = createStore({
    actionError: undefined as string | undefined,
  })

  function ensureFatalErrorRecorded() {
    recordedFatalError ??=
      platform.recordFatalRendererError?.({
        error: formattedError(),
        url: location.href,
        version: platform.version,
        platform: platform.platform,
        os: platform.os,
      }) ?? Promise.resolve()
    return recordedFatalError
  }

  onMount(() => {
    void ensureFatalErrorRecorded().catch(() => undefined)
  })

  async function checkForUpdates() {
    const state = await platform.updater?.check()
    setStore("actionError", state?.status === "error" ? state.message : undefined)
  }

  async function installUpdate() {
    await platform.updater
      ?.install()
      .then(() => setStore("actionError", undefined))
      .catch((err) => {
        setStore("actionError", formatError(err))
      })
  }

  const updateVersion = () => {
    const state = platform.updater?.state()
    if (state?.status !== "ready") return
    return state.version
  }

  async function exportDebugLogs() {
    const exportLogs = platform.exportDebugLogs
    if (!exportLogs) return
    await ensureFatalErrorRecorded()
      .then(() => exportLogs())
      .then(() => setStore("actionError", undefined))
      .catch((err) => {
        setStore("actionError", formatError(err))
      })
  }

  return (
    <div
      class="relative flex-1 h-screen w-screen min-h-0 flex flex-col items-center justify-center font-sans"
      data-tauri-drag-region
    >
      <div class="w-2/3 max-w-3xl flex flex-col items-center justify-center gap-8">
        <Logo class="w-58.5 opacity-12 shrink-0" />
        <div class="flex flex-col items-center gap-2 text-center">
          <h1 class="text-lg font-medium text-text-strong">{"Something went wrong"}</h1>
          <p class="text-sm text-text-weak">
            {({
              "error.page.description": "An error occurred while loading the application.",
              "error.page.description.localServerStartup": "An error occurred while starting the local server.",
            })[errorDescriptionKey(props.error)]}
          </p>
        </div>
        <TextField
          value={formattedError()}
          readOnly
          copyable
          multiline
          class="max-h-96 w-full font-mono text-xs no-scrollbar"
          label={"Error Details"}
          hideLabel
        />
        <div class="flex flex-row items-center justify-center gap-3 flex-wrap max-w-64">
          <Button size="large" onClick={platform.restart}>
            {"Restart"}
          </Button>
          <Show when={platform.platform === "desktop" && platform.exportDebugLogs}>
            <Button size="large" variant="ghost" onClick={exportDebugLogs}>
              {"Export Logs"}
            </Button>
          </Show>
          <Show when={Sentry.isEnabled}>
            {(_) => {
              const [reported, setReported] = createSignal(false)
              return (
                <Button
                  size="large"
                  disabled={reported()}
                  onClick={() => {
                    Sentry.captureException(props.error)
                    setReported(true)
                  }}
                >
                  {reported() ? "Error Reported" : "Report Error"}
                </Button>
              )
            }}
          </Show>
          <Show when={platform.updater}>
            <Show
              when={updateVersion()}
              fallback={
                <Button
                  size="large"
                  variant="ghost"
                  onClick={checkForUpdates}
                  disabled={["checking", "downloading", "installing"].includes(platform.updater?.state().status ?? "")}
                >
                  {platform.updater?.state().status === "checking"
                    ? "Checking..."
                    : "Check for updates"}
                </Button>
              }
            >
              {(version) => (
                <Button size="large" onClick={installUpdate}>
                  {`Update to ${version()}`}
                </Button>
              )}
            </Show>
          </Show>
        </div>
        <Show when={store.actionError}>
          {(message) => <p class="text-xs text-text-danger-base text-center max-w-2xl">{message()}</p>}
        </Show>
        <div class="flex flex-col items-center gap-2">
          <div class="flex items-center justify-center gap-1">
            {"Please report this error to the Redcode team"}
            <button
              type="button"
              class="flex items-center text-text-interactive-base gap-1"
              onClick={() =>
                platform.openExternal("https://github.com/reddb-io/redcode/issues/new?template=bug-report.yml")
              }
            >
              <div>{"on Discord"}</div>
              <Icon name="discord" class="text-text-interactive-base" />
            </button>
          </div>
          <Show when={platform.version}>
            {(version) => (
              <p class="text-xs text-text-weak">{`Version: ${version()}`}</p>
            )}
          </Show>
        </div>
      </div>
    </div>
  )
}
