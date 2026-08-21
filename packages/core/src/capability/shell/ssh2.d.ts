declare module "ssh2" {
  import { EventEmitter } from "node:events"
  import { Readable } from "node:stream"
  import { Socket } from "node:net"

  export interface ConnectConfig {
    host: string
    port?: number
    username: string
    password?: string
    privateKey?: string | Buffer
    tryKeyboard?: boolean
  }

  export interface ExecOptions {
    pty?: { rows?: number; cols?: number; term?: string }
    env?: Record<string, string>
  }

  export class ClientChannel extends EventEmitter {
    readonly stdout: Readable
    readonly stderr: Readable
    signal(signal: string): boolean
    close(): void
  }

  export class Client extends EventEmitter {
    connect(config: ConnectConfig): void
    exec(command: string, options: ExecOptions, callback: (err: Error | undefined, channel: ClientChannel) => void): void
    end(): void
  }

  export interface ServerConfig {
    hostKeys?: Array<string | Buffer>
  }

  export class Server extends EventEmitter {
    constructor(config?: ServerConfig)
    listen(port?: number, host?: string, callback?: () => void): Server
  }
}
