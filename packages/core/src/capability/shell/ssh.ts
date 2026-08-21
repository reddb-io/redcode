import { Client } from "ssh2"
import { Effect, Layer } from "effect"
import { ShellService } from "../shell"

/**
 * SSH-backed shell backend.
 *
 * Phase 3 proof-of-concept: connects to a remote host via ssh2 and routes the
 * `ShellService` surface (`preferred`, `list`, `args`, `killTree`) through a
 * single `exec` channel. The `ProcessService` backend is deliberately out of
 * scope for this PR — the shape is identical and the file can grow into a
 * subdirectory when consumers need spawn semantics.
 *
 * Config (constructed at host boot from `Config.Info.capabilities.shell.ssh`):
 *   { host, port?, username, password?, privateKey? }
 */

export interface SSHConfig {
  readonly host: string
  readonly port?: number
  readonly username: string
  readonly password?: string
  readonly privateKey?: string | Buffer
}

export class SSHConnection {
  private readonly client = new Client()
  private ready = false

  constructor(private readonly config: SSHConfig) {
    this.client.on("ready", () => (this.ready = true))
    this.client.connect({
      host: config.host,
      port: config.port ?? 22,
      username: config.username,
      password: config.password,
      privateKey: config.privateKey,
    })
  }

  exec(command: string): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
    return new Promise((resolve, reject) => {
      if (!this.ready) return reject(new Error("ssh connection not ready"))
      this.client.exec(command, {}, (err, channel) => {
        if (err) return reject(err)
        let stdout = ""
        let stderr = ""
        channel.stdout.on("data", (data: Buffer) => (stdout += data.toString("utf8")))
        channel.stderr.on("data", (data: Buffer) => (stderr += data.toString("utf8")))
        channel.on("exit", (code: number | null) => resolve({ stdout, stderr, exitCode: code }))
      })
    })
  }

  close(): void {
    this.client.end()
  }
}

export const SSH = (config: SSHConfig): ShellService.Backend => ({
  name: "ssh",
  label: `Remote shell over SSH (${config.username}@${config.host})`,
  accepts: (location) => location.startsWith("ssh://") || location.startsWith("ssh:"),
  build: () => {
    const conn = new SSHConnection(config)
    return Layer.succeed(ShellService.Service, {
      preferred: () => "/bin/sh",
      acceptable: () => "/bin/sh",
      list: () =>
        Effect.tryPromise({
          try: () => Promise.resolve([{ path: "/bin/sh", name: "sh", acceptable: true }]),
          catch: (cause) => new ShellService.BackendError({ backend: "ssh", method: "list", cause }),
        }),
      args: (_shell, command, cwd) => ["-c", `cd -- "${cwd.replace(/"/g, '\\"')}" && ${command}`],
      killTree: () => {
        conn.close()
        return Effect.void
      },
    })
  },
})
