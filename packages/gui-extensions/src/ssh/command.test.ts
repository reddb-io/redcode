import { describe, expect, test } from "bun:test"
import { PlatformError } from "effect"
import { parseTarget, quote, sshArgs, tunnelArgs, commandFailureDetail, SshFailure } from "./command"
import { connectionTarget } from "./target"

describe("SSH connection commands", () => {
  test("structured SSH fields preserve Windows key paths and existing jump hosts without a shell", () => {
    expect(
      parseTarget(
        connectionTarget({
          target: "ssh -J gateway [2001:db8::1]",
          user: "filip",
          port: "2222",
          identity: "C:\\Users\\filip\\.ssh\\work's key",
        }),
      ),
    ).toEqual({
      host: "[2001:db8::1]",
      args: [
        "-l",
        "filip",
        "-p",
        "2222",
        "-o",
        "IdentitiesOnly=yes",
        "-i",
        "C:\\Users\\filip\\.ssh\\work's key",
        "-J",
        "gateway",
      ],
    })
    expect(() =>
      parseTarget(connectionTarget({ target: "host", user: "", port: "22 -L 1234:x:80", identity: "" })),
    ).toThrow()
  })
  test("classifies a missing SSH executable from the platform error", () => {
    const error = PlatformError.systemError({
      _tag: "NotFound",
      module: "ChildProcessSpawner",
      method: "spawn",
      pathOrDescriptor: "ssh",
    })

    expect(SshFailure.from(error).code).toBe("ssh-missing")
  })
  test("forwarding overrides bootstrap persistence before reusing the control socket", () => {
    const args = tunnelArgs(
      {
        host: "devbox",
        args: ["-o", "ControlMaster=auto", "-o", "ControlPersist=60", "-o", "ControlPath=/test/socket"],
      },
      1234,
      { host: "127.0.0.1", port: 5678 },
    )

    expect(args.slice(0, 4)).toEqual(["-o", "ControlMaster=no", "-o", "ControlPersist=no"])
    expect(args).toContain("ControlPath=/test/socket")
    expect(args.slice(-4)).toEqual(["-L", "127.0.0.1:1234:127.0.0.1:5678", "devbox", "sh -c 'exec cat >/dev/null'"])
  })
  test("retains CLI stdout failures without exposing private connection details", () => {
    expect(
      commandFailureDetail(1, {
        stdout:
          'OPENCODE_SSH_REGISTRATION_BEGIN\n{"password":"secret"}\nOPENCODE_SSH_REGISTRATION_END\nFailed to read next file',
        stderr: "",
      }),
    ).toBe("Failed to read next file")
    expect(
      commandFailureDetail(1, {
        stdout: 'OPENCODE_SSH_REGISTRATION_BEGIN\n{"password":"secret"}',
        stderr: "read interrupted",
      }),
    ).toBe("read interrupted")
    expect(commandFailureDetail(255, { stdout: "", stderr: "" })).toBe('{"exitCode":255}')
  })
  test("Windows forwarding keeps an independent connection without requiring a Unix shell", () => {
    const args = tunnelArgs({ host: "user@windows", args: [] }, 1234, { host: "127.0.0.1", port: 35555, windows: true })
    expect(args).toContain("-N")
    expect(args.slice(4, 7)).toEqual(["-S", "none", "-N"])
    expect(args.slice(-3)).toEqual(["-L", "127.0.0.1:1234:127.0.0.1:35555", "user@windows"])
  })
  test("preserves aliases and connection options without invoking a shell", () => {
    expect(parseTarget('ssh -p 2222 -i "~/.ssh/work key" -J gateway user@devbox')).toEqual({
      host: "user@devbox",
      args: ["-p", "2222", "-i", "~/.ssh/work key", "-J", "gateway"],
    })
    expect(parseTarget("devbox")).toEqual({ host: "devbox", args: [] })
    expect(parseTarget("ssh user@[::1]").host).toBe("user@[::1]")
    expect(sshArgs(parseTarget("devbox"))).toContain("PermitLocalCommand=no")
  })
  test("rejects remote commands, shell syntax, and transport overrides", () => {
    for (const input of [
      "",
      "ssh host whoami",
      "host;whoami",
      "ssh user:password@host",
      "ssh -t host",
      "ssh -o RemoteCommand=whoami host",
      "ssh -L 1234:x:80 host",
      "ssh -p 70000 host",
      'ssh -i "key host',
      "host\nwhoami",
    ]) {
      expect(() => parseTarget(input)).toThrow()
    }

    expect(quote("a'b")).toBe("'a'\\''b'")
  })
})
