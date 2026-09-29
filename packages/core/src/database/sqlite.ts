export * as Sqlite from "./sqlite.js"

import { Context, Effect, Fiber, Scope, Semaphore, Stream } from "effect"
import { identity } from "effect/Function"
import { SqlClient, Statement } from "effect/unstable/sql"
import type { Connection } from "effect/unstable/sql/SqlConnection"
import type { SqlError } from "effect/unstable/sql/SqlError"

export class Native extends Context.Service<Native, unknown>()("@opencode/core/database/SqliteNative") {}

const busy = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  (("code" in error && error.code === "SQLITE_BUSY") ||
    ("errcode" in error && error.errcode === 5) ||
    ("message" in error && typeof error.message === "string" && /database is locked/i.test(error.message)))

/**
 * Switches a connection to WAL, trying again for a while when another process is switching the
 * same new file at the same moment. That switch needs the file to itself, and when two
 * connections both hold a read lock SQLite answers SQLITE_BUSY at once instead of waiting on the
 * busy timeout. A file already in WAL needs no switch and never waits.
 */
export const enableWal = (run: () => void): Effect.Effect<void> => {
  const attempt = (n: number): Effect.Effect<void, unknown> =>
    Effect.try({ try: run, catch: (cause) => cause }).pipe(
      Effect.catchIf(
        (cause) => n < 50 && busy(cause),
        () =>
          Effect.sleep(Math.round(20 * Math.min(n + 1, 8) * (0.5 + Math.random()))).pipe(
            Effect.andThen(attempt(n + 1)),
          ),
      ),
    )
  return attempt(0).pipe(Effect.orDie)
}

// SQLite's primary result codes, by number, for drivers that only report the number.
const codes = [
  "OK",
  "ERROR",
  "INTERNAL",
  "PERM",
  "ABORT",
  "BUSY",
  "LOCKED",
  "NOMEM",
  "READONLY",
  "INTERRUPT",
  "IOERR",
  "CORRUPT",
  "NOTFOUND",
  "FULL",
  "CANTOPEN",
  "PROTOCOL",
  "EMPTY",
  "SCHEMA",
  "TOOBIG",
  "CONSTRAINT",
  "MISMATCH",
  "MISUSE",
  "NOLFS",
  "AUTH",
  "FORMAT",
  "RANGE",
  "NOTADB",
]

/**
 * The message for a statement SQLite refused, naming what ran and why:
 * "Failed to execute statement (INSERT, SQLITE_BUSY: database is locked)". The bare
 * "Failed to execute statement" left a crashed turn with nothing to tell a lock wait that ran out
 * from a constraint or a full disk. Reads bun:sqlite's string `code` and node:sqlite's numeric
 * `errcode`; never includes parameters, which may hold user content.
 */
export const failure = (cause: unknown, query: string) => {
  const kind = /^\s*([A-Za-z]+)/.exec(query)?.[1]?.toUpperCase() ?? "SQL"
  if (typeof cause !== "object" || cause === null) return `Failed to execute statement (${kind})`
  const error = cause as { code?: unknown; errcode?: unknown; errstr?: unknown; message?: unknown }
  const code =
    typeof error.code === "string" && error.code.startsWith("SQLITE_")
      ? error.code
      : typeof error.errcode === "number"
        ? `SQLITE_${codes[error.errcode & 0xff] ?? error.errcode}`
        : undefined
  const detail = [error.errstr, error.message].find(
    (text): text is string => typeof text === "string" && text.length > 0,
  )
  return `Failed to execute statement (${[kind, [code, detail].filter(Boolean).join(": ")].filter(Boolean).join(", ")})`
}

export interface ClientConfig {
  readonly spanAttributes?: Record<string, unknown>
  readonly transformResultNames?: (str: string) => string
  readonly transformQueryNames?: (str: string) => string
}

type Run = (
  query: string,
  params?: ReadonlyArray<unknown>,
) => Effect.Effect<ReadonlyArray<Record<string, unknown>>, SqlError>

type RunValues = (
  query: string,
  params?: ReadonlyArray<unknown>,
) => Effect.Effect<ReadonlyArray<ReadonlyArray<unknown>>, SqlError>

type RunStream = (query: string, params: ReadonlyArray<unknown>) => Stream.Stream<Record<string, unknown>, SqlError>

export const makeConnection = <Extensions extends object>(
  run: Run,
  runValues: RunValues,
  extensions: Extensions,
  runStream?: RunStream,
) =>
  identity<Connection & Extensions>({
    execute(query, params, transformRows) {
      return transformRows ? Effect.map(run(query, params), transformRows) : run(query, params)
    },
    executeRaw(query, params) {
      return run(query, params)
    },
    executeValues(query, params) {
      return runValues(query, params)
    },
    executeValuesUnprepared(query, params) {
      return runValues(query, params)
    },
    executeUnprepared(query, params, transformRows) {
      return this.execute(query, params, transformRows)
    },
    executeStream(query, params, transformRows) {
      if (!runStream) return Stream.fromIterableEffect(this.execute(query, params, transformRows))
      return Stream.flatMap(runStream(query, params), (row) =>
        Stream.fromIterable(transformRows ? transformRows([row]) : [row]),
      )
    },
    ...extensions,
  })

export const makeClient = <
  Config extends ClientConfig,
  SqliteConnection extends Connection,
  const TypeId extends string,
  Extensions extends object,
>(
  options: Config,
  connection: SqliteConnection,
  typeId: TypeId,
  extensions: (acquirer: Effect.Effect<SqliteConnection, SqlError, Scope.Scope>) => Extensions,
) =>
  Effect.gen(function* () {
    const semaphore = yield* Semaphore.make(1)
    const acquirer = semaphore.withPermits(1)(Effect.succeed(connection))
    const transactionAcquirer = Effect.uninterruptibleMask((restore) => {
      const fiber = Fiber.getCurrent()!
      const scope = Context.getUnsafe(fiber.context, Scope.Scope)
      return Effect.as(
        Effect.tap(restore(semaphore.take(1)), () => Scope.addFinalizer(scope, semaphore.release(1))),
        connection,
      )
    })
    const transformRows = options.transformResultNames
      ? Statement.defaultTransforms(options.transformResultNames).array
      : undefined

    return Object.assign(
      yield* SqlClient.make({
        acquirer,
        compiler: Statement.makeCompilerSqlite(options.transformQueryNames),
        transactionAcquirer,
        spanAttributes: [
          ...(options.spanAttributes ? Object.entries(options.spanAttributes) : []),
          ["db.system.name", "sqlite"],
        ],
        transformRows,
      }),
      {
        [typeId]: typeId,
        config: options,
        ...extensions(acquirer),
      },
    ) as SqlClient.SqlClient &
      Record<TypeId, TypeId> & {
        readonly config: Config
        readonly updateValues: never
      } & Extensions
  })
