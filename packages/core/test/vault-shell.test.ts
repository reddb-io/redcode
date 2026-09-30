import { describe, expect, test } from "bun:test"
import { VaultShell } from "../src/vault/shell.js"
import { ShellSelect } from "../src/shell/select.js"

// Every value is assembled from parts so no secret scanner mistakes it for a real credential.
const plain = "tok" + "_" + "a1B2c3D4e5F6g7H8"
const hostile = [
  "it's",
  ' a "test" ',
  "$(echo pwned)",
  " `echo pwned` ",
  "; echo pwned & | > < * ? ~ ! \\ ${HOME} %PATH% ",
  "end",
].join("")
const multiline = "first line\nsecond 'line'\n\tthird $x"
const endsHeredoc = "a\nEOF\nb"

const bash = Bun.which("bash")
const sh = Bun.which("sh")
const posix = [bash, sh].flatMap((shell) => (shell ? [shell] : []))
const runs = process.platform === "win32" ? [] : posix

/** Runs a bound command the way the shell tool does: the script on standard input, the fallback variables set. */
const run = async (shell: string, command: string, value: string) => {
  const bound = VaultShell.bind(command, shell, new Map([["t", value]]))
  if ("failure" in bound) return { failure: bound.failure, output: "", bound }
  const child = Bun.spawn([shell, ...ShellSelect.scriptArgs(shell)], {
    stdin: new TextEncoder().encode(bound.script ?? ""),
    env: { PATH: process.env.PATH ?? "", HOME: "/nonexistent", ...bound.env },
    stdout: "pipe",
    stderr: "pipe",
  })
  const output = await new Response(child.stdout).text()
  await child.exited
  return { failure: undefined, output, bound }
}

// Command shapes as a model writes them, with the program replaced by one that prints what it received.
const shapes: ReadonlyArray<{
  readonly name: string
  readonly command: string
  readonly expect: (value: string) => string
}> = [
  { name: "bare word", command: "printf '%s' {vault:t}", expect: (value) => value },
  { name: "word part", command: "printf '%s' me:{vault:t}", expect: (value) => `me:${value}` },
  {
    name: "double-quoted header",
    command: `printf '%s' "Authorization: Bearer {vault:t}"`,
    expect: (value) => `Authorization: Bearer ${value}`,
  },
  {
    name: "single-quoted header",
    command: `printf '%s' 'Authorization: Bearer {vault:t}'`,
    expect: (value) => `Authorization: Bearer ${value}`,
  },
  {
    name: "single-quoted JSON body",
    command: `printf '%s' '{"key":"{vault:t}"}'`,
    expect: (value) => `{"key":"${value}"}`,
  },
  {
    name: "command substitution in double quotes",
    command: `printf '%s' "$(printf '%s' '{vault:t}')"`,
    expect: (value) => value,
  },
  { name: "backticks", command: "printf '%s' \"`printf '%s' {vault:t}`\"", expect: (value) => value },
  { name: "unquoted heredoc", command: "cat <<EOF\nkey={vault:t}\nEOF", expect: (value) => `key=${value}\n` },
  { name: "quoted heredoc", command: "cat <<'EOF'\nkey={vault:t}\nEOF", expect: (value) => `key=${value}\n` },
  { name: "tab-stripped heredoc", command: "cat <<-EOF\n\tkey={vault:t}\n\tEOF", expect: (value) => `key=${value}\n` },
  {
    name: "curl with header, body and URL",
    command: `curl() { printf '%s\\n' "$@"; }; curl -s -H 'Authorization: Bearer {vault:t}' -d '{"token":"{vault:t}"}' https://api.example.com/login`,
    expect: (value) =>
      [
        "-s",
        "-H",
        `Authorization: Bearer ${value}`,
        "-d",
        `{"token":"${value}"}`,
        "https://api.example.com/login",
        "",
      ].join("\n"),
  },
  {
    name: "wget header",
    command: `wget() { printf '%s\\n' "$@"; }; wget --header="PRIVATE-TOKEN: {vault:t}" https://gitlab.example.com/api`,
    expect: (value) => [`--header=PRIVATE-TOKEN: ${value}`, "https://gitlab.example.com/api", ""].join("\n"),
  },
  {
    name: "git extra header",
    command: `git() { printf '%s\\n' "$@"; }; git -c http.extraHeader="Authorization: Bearer {vault:t}" clone https://github.com/o/r`,
    expect: (value) =>
      ["-c", `http.extraHeader=Authorization: Bearer ${value}`, "clone", "https://github.com/o/r", ""].join("\n"),
  },
  {
    name: "psql connection URL",
    command: `psql() { printf '%s\\n' "$@"; }; psql "postgres://app:{vault:t}@db.example.com/app" -c 'select 1'`,
    expect: (value) => [`postgres://app:${value}@db.example.com/app`, "-c", "select 1", ""].join("\n"),
  },
  {
    name: "docker login from stdin",
    command: `docker() { cat; }; printf '%s' '{vault:t}' | docker login -u me --password-stdin registry.example.com`,
    expect: (value) => value,
  },
  {
    name: "exported variable",
    command: `export TOKEN={vault:t}; printf '%s' "$TOKEN"`,
    expect: (value) => value,
  },
  {
    name: "subshell inside command substitution",
    command: `printf '%s' "$( (printf '%s' {vault:t}) )"`,
    expect: (value) => value,
  },
  { name: "hash inside a word", command: "printf '%s' a#{vault:t}", expect: (value) => `a#${value}` },
  {
    name: "single quotes inside backticks",
    command: "x=`printf '%s' 'k={vault:t}'`; printf '%s' \"$x\"",
    expect: (value) => `k=${value}`,
  },
  {
    name: "double quotes inside backticks",
    command: "x=`printf '%s' \"k={vault:t}\"`; printf '%s' \"$x\"",
    expect: (value) => `k=${value}`,
  },
  { name: "dollar-quote inside double quotes", command: `printf '%s' "$'{vault:t}"`, expect: (value) => `$'${value}` },
  {
    name: "double-quoted heredoc delimiter",
    command: 'cat <<"EOF"\nkey={vault:t}\nEOF',
    expect: (value) => `key=${value}\n`,
  },
  { name: "escaped heredoc delimiter", command: "cat <<\\EOF\nkey={vault:t}\nEOF", expect: (value) => `key=${value}\n` },
  {
    name: "two heredocs opened on one line",
    command: "cat <<A; cat <<'B'\nx={vault:t}\nA\ny={vault:t}\nB",
    expect: (value) => `x=${value}\ny=${value}\n`,
  },
]

// Quoting only bash reads: ANSI-C strings, locale strings and here-strings.
const bashShapes: typeof shapes = [
  { name: "ANSI-C string", command: "printf '%s' $'k={vault:t}\\tz'", expect: (value) => `k=${value}\tz` },
  {
    name: "ANSI-C string inside backticks",
    command: "x=`printf '%s' $'k={vault:t}'`; printf '%s' \"$x\"",
    expect: (value) => `k=${value}`,
  },
  { name: "locale string", command: `printf '%s' $"k={vault:t}"`, expect: (value) => `k=${value}` },
  { name: "here-string", command: "cat <<<{vault:t}", expect: (value) => `${value}\n` },
]
const bashRuns = process.platform === "win32" || !bash ? [] : [bash]

describe("VaultShell.bind on POSIX shells", () => {
  for (const shell of runs)
    for (const shape of shapes)
      for (const [label, value] of [
        ["plain", plain],
        ["hostile", hostile],
        ["multi-line", multiline],
      ] as const)
        test(`${ShellSelect.name(shell)}: ${shape.name} with a ${label} value`, async () => {
          const result = await run(shell, shape.command, value)
          expect(result.failure).toBeUndefined()
          expect(result.output).toBe(shape.expect(value))
          expect(result.output).not.toContain("pwned\n")
          // What is stored and approved keeps the name; only the script on standard input carries the value.
          expect("failure" in result.bound ? "" : result.bound.command).toBe(shape.command)
          expect(ShellSelect.scriptArgs(shell).join(" ")).not.toContain(value)
        })

  for (const shell of bashRuns)
    for (const shape of bashShapes)
      for (const [label, value] of [
        ["plain", plain],
        ["hostile", hostile],
        ["multi-line", multiline],
      ] as const)
        test(`bash only: ${shape.name} with a ${label} value`, async () => {
          const result = await run(shell, shape.command, value)
          expect(result.failure).toBeUndefined()
          expect(result.output).toBe(shape.expect(value))
          expect(result.output).not.toContain("pwned\n")
          expect("failure" in result.bound ? "" : result.bound.command).toBe(shape.command)
        })

  test("reads a value inside backticks through one variable per name", () => {
    const other = "other-" + plain
    expect(
      VaultShell.bind(
        "echo `echo {vault:t} {vault:t} {vault:u}`",
        "/bin/sh",
        new Map([
          ["t", plain],
          ["u", other],
        ]),
      ),
    ).toEqual({
      script: 'echo `echo "${REDCODE_VAULT_1}" "${REDCODE_VAULT_1}" "${REDCODE_VAULT_2}"`',
      command: "echo `echo {vault:t} {vault:t} {vault:u}`",
      env: { REDCODE_VAULT_1: plain, REDCODE_VAULT_2: other },
    })
  })

  test("keeps escaped and unresolved references in an unquoted heredoc body", () => {
    expect(
      VaultShell.bind("cat <<EOF\n\\{vault:t} {vault:u} {vault:t}\nEOF", "/bin/bash", new Map([["t", plain]])),
    ).toEqual({
      script: "cat <<EOF\n\\{vault:t} {vault:u} ${REDCODE_VAULT_1}\nEOF",
      command: expect.any(String),
      env: { REDCODE_VAULT_1: plain },
    })
  })

  test("refuses a value that would end a tab-stripped or CRLF quoted heredoc, and only that one", () => {
    const tabbed = "a\n\t\tEOF\nb"
    const stripped = VaultShell.bind("cat <<-'EOF'\n\t{vault:t}\n\tEOF", "/bin/bash", new Map([["t", tabbed]]))
    expect("failure" in stripped ? stripped.failure : "").toContain("{vault:t} would end the quoted heredoc EOF early")
    expect(JSON.stringify(stripped)).not.toContain(tabbed)
    // Without `<<-` a tab-indented line does not end the body.
    const kept = VaultShell.bind("cat <<'EOF'\n{vault:t}\nEOF", "/bin/bash", new Map([["t", tabbed]]))
    expect("script" in kept ? kept.script : "").toBe(`cat <<'EOF'\n${tabbed}\nEOF`)
    const crlf = VaultShell.bind("cat <<'EOF'\n{vault:t}\nEOF", "/bin/bash", new Map([["t", "x\nEOF\r\ny"]]))
    expect("failure" in crlf ? crlf.failure : "").toContain("would end the quoted heredoc EOF early")
  })

  test("writes into a heredoc that never ends, and keeps a reference after an unclosed delimiter quote", () => {
    const open = VaultShell.bind("cat <<'EOF'\n{vault:t}\n", "/bin/bash", new Map([["t", plain]]))
    expect("script" in open ? open.script : "").toBe(`cat <<'EOF'\n${plain}\n`)
    const unclosed = VaultShell.bind("cat <<'EOF\n{vault:t}", "/bin/bash", new Map([["t", plain]]))
    expect("script" in unclosed ? unclosed.script : "").toBe("cat <<'EOF\n{vault:t}")
  })

  test("keeps an escaped reference and a comment literal", () => {
    const bound = VaultShell.bind("printf '%s' \\{vault:t} # uses {vault:t}", "/bin/sh", new Map([["t", plain]]))
    expect(bound).toEqual({ script: "printf '%s' \\{vault:t} # uses {vault:t}", command: expect.any(String), env: {} })
  })

  test("writes a value that would end an unquoted heredoc through a variable", () => {
    const bound = VaultShell.bind("cat <<EOF\n{vault:t}\nEOF", "/bin/bash", new Map([["t", endsHeredoc]]))
    expect(bound).toEqual({
      script: "cat <<EOF\n${REDCODE_VAULT_1}\nEOF",
      command: expect.any(String),
      env: { REDCODE_VAULT_1: endsHeredoc },
    })
  })

  test("refuses a value that would end a quoted heredoc, naming only the reference", () => {
    const bound = VaultShell.bind("cat <<'EOF'\n{vault:t}\nEOF", "/bin/bash", new Map([["t", endsHeredoc]]))
    expect("failure" in bound ? bound.failure : "").toContain("{vault:t} would end the quoted heredoc EOF early")
    expect(JSON.stringify(bound)).not.toContain(endsHeredoc)
  })

  test("refuses a NUL character", () => {
    const bound = VaultShell.bind("printf %s {vault:t}", "/bin/bash", new Map([["t", "a\0b"]]))
    expect(bound).toEqual({ failure: "{vault:t} holds a NUL character, which no shell script can carry." })
  })

  test("reads arithmetic shifts as no heredoc", () => {
    const bound = VaultShell.bind("echo $((1<<2)) {vault:t}", "/bin/bash", new Map([["t", plain]]))
    expect("script" in bound ? bound.script : "").toBe(`echo $((1<<2)) '${plain}'`)
  })

  test("leaves a reference the command does not resolve as written", () => {
    const bound = VaultShell.bind("printf %s {vault:other}", "/bin/bash", new Map([["t", plain]]))
    expect("script" in bound ? bound.script : "").toBe("printf %s {vault:other}")
  })
})

describe("VaultShell.bind on PowerShell", () => {
  const values = new Map([["t", hostile]])
  const script = (command: string) => {
    const bound = VaultShell.bind(command, "pwsh", values)
    return "script" in bound ? (bound.script ?? "") : bound.failure
  }
  const quoted = hostile.replaceAll("'", "''")

  test("quotes a bare word and doubles quotes inside single quotes", () => {
    expect(script("curl.exe -u {vault:t}")).toBe(`curl.exe -u '${quoted}'`)
    expect(script("Write-Output 'Bearer {vault:t}'")).toBe(`Write-Output 'Bearer ${quoted}'`)
  })

  test("escapes backticks, dollars and quotes inside double quotes", () => {
    expect(script('Write-Output "Bearer {vault:t}"')).toBe(`Write-Output "Bearer ${hostile.replace(/[`$"]/g, "`$&")}"`)
  })

  test("expands a variable inside an expandable here-string and refuses one that would end a literal one", () => {
    const expandable = VaultShell.bind('$body = @"\n{vault:t}\n"@', "pwsh", values)
    expect(expandable).toEqual({
      script: '$body = @"\n${env:REDCODE_VAULT_1}\n"@',
      command: '$body = @"\n{vault:t}\n"@',
      env: { REDCODE_VAULT_1: hostile },
    })
    const literal = VaultShell.bind("$body = @'\n{vault:t}\n'@", "pwsh", new Map([["t", "x\n'@\ny"]]))
    expect("failure" in literal ? literal.failure : "").toContain("{vault:t} would end the literal here-string early")
  })

  test("keeps doubled quotes inside strings and closes typographic single quotes", () => {
    expect(script("Write-Output 'it''s {vault:t}'")).toBe(`Write-Output 'it''s ${quoted}'`)
    expect(script('Write-Output "say ""hi"" {vault:t}"')).toBe(
      `Write-Output "say ""hi"" ${hostile.replace(/[`$"]/g, "`$&")}"`,
    )
    const curly = "it’s-" + plain
    const bound = VaultShell.bind("Write-Output ‘Bearer {vault:t}’", "pwsh", new Map([["t", curly]]))
    expect("script" in bound ? bound.script : "").toBe(`Write-Output ‘Bearer it’’s-${plain}’`)
  })

  test("quotes a value inside a subexpression, also within a string and nested parentheses", () => {
    expect(script('Write-Output "x $(Get-Item {vault:t}) y"')).toBe(`Write-Output "x $(Get-Item '${quoted}') y"`)
    expect(script("$( (Get-A) + {vault:t} )")).toBe(`$( (Get-A) + '${quoted}' )`)
    expect(script("@('a', {vault:t})")).toBe(`@('a', '${quoted}')`)
  })

  test("keeps references in comments and after a backtick escape", () => {
    expect(script("Write-Output x # {vault:t}")).toBe("Write-Output x # {vault:t}")
    expect(script("<# {vault:t} #> Write-Output {vault:t}")).toBe(`<# {vault:t} #> Write-Output '${quoted}'`)
    expect(script("Write-Output `{vault:t}")).toBe("Write-Output `{vault:t}")
    expect(script("Write-Output a#{vault:t}")).toBe(`Write-Output a#'${quoted}'`)
  })

  test("writes a literal here-string value as is and resumes code after it", () => {
    expect(script("$body = @'\n{vault:t}\n'@ + {vault:t}")).toBe(`$body = @'\n${hostile}\n'@ + '${quoted}'`)
    expect(VaultShell.bind('$body = @"   \n{vault:t}\n"@', "pwsh", values)).toEqual({
      script: '$body = @"   \n${env:REDCODE_VAULT_1}\n"@',
      command: '$body = @"   \n{vault:t}\n"@',
      env: { REDCODE_VAULT_1: hostile },
    })
  })

  test("refuses a NUL character and treats Windows PowerShell alike", () => {
    expect(VaultShell.bind("Write-Output {vault:t}", "pwsh", new Map([["t", "a\0b"]]))).toEqual({
      failure: "{vault:t} holds a NUL character, which no shell script can carry.",
    })
    const bound = VaultShell.bind("Write-Output {vault:t}", "powershell", values)
    expect("script" in bound ? bound.script : "").toBe(`Write-Output '${quoted}'`)
  })

  test("reads the script from standard input", () => {
    expect(ShellSelect.scriptArgs("pwsh").at(-1)).toBe("Invoke-Expression ([Console]::In.ReadToEnd())")
  })
})

describe("VaultShell.bind on cmd", () => {
  test("keeps the command with variables and no script", () => {
    expect(VaultShell.bind("curl -u me:{vault:t} https://x", "cmd", new Map([["t", plain]]))).toEqual({
      script: undefined,
      command: "curl -u me:%REDCODE_VAULT_1% https://x",
      env: { REDCODE_VAULT_1: plain },
    })
  })

  test("shares one variable per name and leaves an unresolved reference as written", () => {
    const bound = VaultShell.bind("set A={vault:t}&& set B={vault:t}&& echo {vault:u}", "cmd", new Map([["t", plain]]))
    expect(bound).toEqual({
      script: undefined,
      command: "set A=%REDCODE_VAULT_1%&& set B=%REDCODE_VAULT_1%&& echo {vault:u}",
      env: { REDCODE_VAULT_1: plain },
    })
    expect("command" in bound ? bound.command : plain).not.toContain(plain)
  })
})
