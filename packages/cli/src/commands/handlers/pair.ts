import { cancel, confirm, isCancel, log, select, text } from "@clack/prompts"
import { EOL } from "os"
import { Effect, Option, Schedule } from "effect"
import { Service } from "@opencode/client/effect/service"
import { OpenCode } from "@opencode/client/promise"
import { renderUnicodeCompact } from "uqr"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { RemoteTunnel } from "../../services/remote-tunnel"
import { ServiceConfig } from "../../services/service-config"

export default Runtime.handler(
  Commands.commands.pair,
  Effect.fn("cli.pair")(function* (input: Runtime.Input<typeof Commands.commands.pair>) {
    const config = yield* ServiceConfig.read()
    if (config.disabled === true)
      return yield* Effect.fail(
        new Error("Pairing requires the background service; run `redcode service unset disabled` first"),
      )
    if (input.remote && Option.isSome(input.url))
      return yield* Effect.fail(new Error("--remote cannot be combined with --url"))
    if (!input.remote && Option.isSome(input.relay)) return yield* Effect.fail(new Error("--relay requires --remote"))
    if (input.remote) {
      if (config.remote === undefined && !(yield* remoteConsent(config, input))) return
      const relay =
        Option.getOrUndefined(input.relay) ??
        config.relay ??
        (config.remote ? RemoteTunnel.HOSTED_API : yield* chooseRelay())
      if (!relay) return
      if (config.remote === undefined || config.relay !== relay)
        yield* ServiceConfig.enableRemote(relay)
    }
    const endpoint = yield* Service.ensure(yield* ServiceConfig.options())
    const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
    const urls = yield* pairingURLs(client, input)
    const pairing = yield* Effect.tryPromise(() => client.server.pair())
    const links = urls.map((url) => new URL(`/auth/connect/${pairing.code}`, url).href)
    // Loopback URLs are useless to the scanning device, so the QR code only carries reachable addresses.
    const remote = urls.filter((url) => !isLoopback(new URL(url).hostname))
    process.stdout.write(
      [
        "",
        `  Open a link to connect. Links work once and expire in ${Math.round(pairing.expires_in / 60)} minutes.`,
        "",
        ...(links.length ? links.map((link) => `  ${link}`) : ["  (no server URLs)"]),
        ...(remote.length
          ? [
              "",
              // uqr separates rows with "\n" on every platform, so splitting on EOL ("\r\n" on Windows) indents only the first row.
              renderUnicodeCompact(JSON.stringify({ code: pairing.code, urls: remote }), {
                border: 2,
              })
                .split("\n")
                .map((line) => "  " + line)
                .join(EOL),
            ]
          : []),
        "",
      ].join(EOL) + EOL,
    )

    if (input.remote || config.remote || Option.isSome(input.url)) return
    const url = new URL(endpoint.url)
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return
    process.stderr.write(
      [
        `  Over SSH? Forward the port, then open the link on your machine:`,
        `  ssh -L ${url.port}:${url.hostname}:${url.port} <host>`,
        `  If port ${url.port} is busy locally, forward another port and use it in the link.`,
        "",
        "  To connect from other devices, run `redcode service set hostname 0.0.0.0`.",
        "",
      ].join(EOL) + EOL,
    )
  }),
)

export const remoteWarning = [
  "This will expose your Redcode server to the internet.",
  "Traffic is end-to-end encrypted, and access requires your server password.",
  "To pair locally instead, run `redcode pair` without the --remote flag.",
].join(EOL)

export interface RemoteConsentPrompt {
  readonly interactive: () => boolean
  readonly confirm: () => Promise<boolean | symbol>
}

const terminalPrompt: RemoteConsentPrompt = {
  interactive: () => Boolean(process.stdin.isTTY && process.stdout.isTTY),
  confirm: () => confirm({ message: "Expose your server to the internet?", initialValue: true }),
}

// Remote access is only explained and accepted the first time it is turned on; once accepted, pairing goes straight
// through. Returns whether remote access may be enabled.
export const remoteConsent = Effect.fn("cli.pair.remote-consent")(function* (
  config: ServiceConfig.Info,
  input: { readonly yes: boolean },
  terminal: RemoteConsentPrompt = terminalPrompt,
) {
  if (config.remote !== undefined || config.remoteAccepted === true) return true
  if (!input.yes && !terminal.interactive()) {
    process.stderr.write([remoteWarning, "Run interactively or pass --yes to continue."].join(EOL) + EOL)
    process.exitCode = 1
    return false
  }
  log.warn(remoteWarning)
  if (!input.yes) {
    const accepted = yield* Effect.promise(terminal.confirm)
    if (isCancel(accepted)) {
      cancel("Remote access was not enabled. To pair locally, run `redcode pair`.")
      process.exitCode = 130
      return false
    }
    if (accepted !== true) {
      log.info("Remote access was not enabled. To pair locally, run `redcode pair`.")
      return false
    }
  }
  yield* ServiceConfig.acceptRemote()
  return true
})

const pairingURLs = Effect.fnUntraced(function* (
  client: ReturnType<typeof OpenCode.make>,
  input: Runtime.Input<typeof Commands.commands.pair>,
) {
  if (input.remote) return [yield* remoteURL(client)]
  if (Option.isSome(input.url)) return [input.url.value]
  if ((yield* ServiceConfig.read()).remote) return [yield* remoteURL(client)]
  return (yield* Effect.tryPromise(() => client.server.info())).urls
})

const chooseRelay = Effect.fn("cli.pair.relay")(function* () {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    return yield* Effect.fail(
      new Error(
        "Choose a relay with --relay <https://your-relay> (or explicitly --relay https://opentunnel.xyz). --yes only accepts internet exposure.",
      ),
    )
  const provider = yield* Effect.promise(() =>
    select({
      message: "Where should Redcode connect?",
      options: [
        { value: "self", label: "Your own relay", hint: "OpenTunnel-compatible API on your infrastructure" },
        { value: "hosted", label: "Hosted OpenTunnel", hint: "Uses the external service at opentunnel.xyz" },
      ],
    }),
  )
  if (isCancel(provider)) {
    cancel("Pairing cancelled")
    process.exitCode = 130
    return
  }
  if (provider === "hosted") return RemoteTunnel.HOSTED_API
  const address = yield* Effect.promise(() =>
    text({
      message: "Relay API address",
      placeholder: "https://relay.example.org",
      validate: (value) => {
        try {
          RemoteTunnel.apiURL(value ?? "")
        } catch {
          return "Enter an HTTPS origin; HTTP loopback is supported for local development"
        }
      },
    }),
  )
  if (isCancel(address)) {
    cancel("Pairing cancelled")
    process.exitCode = 130
    return
  }
  return RemoteTunnel.apiURL(address)
})

// The service attaches the tunnel in the background, so wait for its URL to appear in server info.
const remoteURL = Effect.fnUntraced(function* (client: ReturnType<typeof OpenCode.make>) {
  const tunnelURL = Effect.gen(function* () {
    const config = yield* ServiceConfig.read()
    const route = config.remote?.route
    const hostname = route === undefined ? undefined : yield* RemoteTunnel.hostname(route, config.relay)
    const info = yield* Effect.tryPromise(() => client.server.info())
    const url = info.urls.find((candidate) => hostname !== undefined && new URL(candidate).hostname === hostname)
    if (url === undefined) return yield* Effect.fail(new Error("Remote tunnel is not ready"))
    return url
  })
  return yield* tunnelURL.pipe(
    Effect.retry({ schedule: Schedule.spaced("1 second") }),
    Effect.timeoutOrElse({
      duration: "3 minutes",
      orElse: () =>
        Effect.fail(new Error("Timed out waiting for the remote tunnel; run `redcode pair --remote` again to retry")),
    }),
  )
})

function isLoopback(hostname: string) {
  return (
    hostname === "localhost" || hostname.endsWith(".localhost") || hostname.startsWith("127.") || hostname === "[::1]"
  )
}
