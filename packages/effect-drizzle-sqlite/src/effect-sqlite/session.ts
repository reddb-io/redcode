/* oxlint-disable */
import * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Scope from "effect/Scope"
import type { SqlClient } from "effect/unstable/sql/SqlClient"
import { isSqlError, type SqlError } from "effect/unstable/sql/SqlError"
import type { EffectCacheShape } from "drizzle-orm/cache/core/cache-effect"
import type { WithCacheConfig } from "drizzle-orm/cache/core/types"
import type { EffectLoggerShape } from "drizzle-orm/effect-core/logger"
import type { QueryEffectHKTBase } from "drizzle-orm/effect-core/query-effect"
import { EffectDrizzleError, EffectDrizzleQueryError } from "drizzle-orm/effect-core/errors"
import { entityKind, is } from "drizzle-orm/entity"
import type { AnyRelations } from "drizzle-orm/relations"
import type { RelationalQueryMapperConfig } from "drizzle-orm/relations"
import type { Query } from "drizzle-orm/sql/sql"
import type { SQLiteAsyncDialect } from "drizzle-orm/sqlite-core/dialect"
import {
  SQLiteEffectPreparedQuery,
  SQLiteEffectSession,
  SQLiteEffectTransaction,
  type SQLiteEffectTransactionConfig,
  type TransactionRetry,
} from "../sqlite-core/effect/session"
import type { SelectedFieldsOrdered } from "drizzle-orm/sqlite-core/query-builders/select.types"
import type { PreparedQueryConfig, SQLiteExecuteMethod, SQLiteTransactionConfig } from "drizzle-orm/sqlite-core/session"

export type { SQLiteEffectTransactionConfig, TransactionRetry } from "../sqlite-core/effect/session"

export interface EffectSQLiteQueryEffectHKT extends QueryEffectHKTBase {
  readonly error: EffectDrizzleQueryError
  readonly context: never
}

export type EffectSQLiteRunResult = readonly never[]

/**
 * Defaults for every `transaction` on a database. Under WAL with more than one process writing,
 * `immediate` is the safe mode: a transaction that reads first and writes later would otherwise
 * fail with `SQLITE_BUSY_SNAPSHOT` once another writer commits in between, and the busy timeout
 * does not wait that one out. The retry re-runs the whole transaction body, so bodies must only
 * touch the database (or be idempotent otherwise); statements never retry individually. A
 * transaction may name its own `retry` to replace the default for that call.
 */
export interface TransactionDefaults {
  readonly behavior?: SQLiteTransactionConfig["behavior"]
  readonly retry?: TransactionRetry
}

export interface EffectSQLiteSessionOptions {
  logger: EffectLoggerShape
  cache: EffectCacheShape
  useJitMappers?: boolean
  transaction?: TransactionDefaults
}

/**
 * Effects to run once the outermost transaction has committed and released its connection,
 * registered from inside the transaction with {@link afterCommit}. Fresh for every attempt, so
 * what a rolled-back attempt registered never runs.
 */
class TransactionHooks extends Context.Service<
  TransactionHooks,
  { readonly afterCommit: Array<Effect.Effect<void>> }
>()("@reddb-io/redcode-effect-drizzle-sqlite/TransactionHooks") {}

/**
 * Runs `effect` after the enclosing transaction commits, or right away when no transaction is
 * open. For what must not happen against state that may still roll back, and must not happen
 * while the write lock and the connection are held: notifying in-memory listeners of a write.
 */
export const afterCommit = (effect: Effect.Effect<void>): Effect.Effect<void> =>
  Effect.serviceOption(TransactionHooks).pipe(
    Effect.flatMap((hooks) =>
      hooks._tag === "Some"
        ? Effect.sync(() => {
            hooks.value.afterCommit.push(effect)
          })
        : effect,
    ),
  )

/**
 * Whether a native SQLite error says the database is busy (SQLITE_BUSY: another connection holds
 * the lock, which waiting resolves) rather than locked (SQLITE_LOCKED: a conflict inside this
 * connection, which waiting never resolves). `undefined` when the error carries neither code.
 * Reads bun:sqlite's `code`/`errno`, node:sqlite's `errcode`/`errstr`, and the message as a last
 * resort: SQLITE_BUSY reads "database is locked", SQLITE_LOCKED "database table is locked".
 */
const isBusy = (cause: unknown): boolean | undefined => {
  if (typeof cause !== "object" || cause === null) return undefined
  const error = cause as { code?: unknown; errno?: unknown; errcode?: unknown; errstr?: unknown; message?: unknown }
  for (const numeric of [error.errno, error.errcode]) {
    if (typeof numeric !== "number") continue
    const primary = numeric & 0xff
    if (primary === 5) return true
    if (primary === 6) return false
  }
  if (typeof error.code === "string" && error.code.startsWith("SQLITE_")) {
    if (error.code.startsWith("SQLITE_BUSY")) return true
    if (error.code.startsWith("SQLITE_LOCKED")) return false
  }
  for (const text of [error.errstr, error.message]) {
    if (typeof text !== "string") continue
    if (/table is locked/i.test(text)) return false
    if (/database is locked/i.test(text)) return true
  }
  return undefined
}

/**
 * A failure SQLite reports when another connection holds the lock this transaction needs: the
 * `SqlError` from `begin`, or the same error wrapped in a query error by a statement of the body.
 * Only SQLITE_BUSY counts. `LockTimeoutError` also stands for SQLITE_LOCKED, which is a conflict
 * within one connection, so the native cause decides; a lock timeout without a readable cause
 * is trusted.
 */
export const isLockError = (error: unknown): boolean => {
  if (isSqlError(error)) {
    const busy = isBusy(error.reason.cause)
    return busy ?? error.reason._tag === "LockTimeoutError"
  }
  if (is(error, EffectDrizzleQueryError) || is(error, EffectDrizzleError)) {
    const cause = error.cause
    if (Cause.isCause(cause)) return cause.reasons.some((reason) => reason._tag === "Fail" && isLockError(reason.error))
    return isLockError(cause)
  }
  return false
}

const retryDelay = (retry: TransactionRetry, attempt: number) => {
  const capped = Math.min(retry.maxDelayMs, retry.baseDelayMs * 2 ** attempt)
  return Math.round(capped * (0.5 + Math.random()))
}

export class EffectSQLiteSession<TRelations extends AnyRelations> extends SQLiteEffectSession<
  EffectSQLiteQueryEffectHKT,
  EffectSQLiteRunResult,
  TRelations
> {
  static override readonly [entityKind]: string = "EffectSQLiteSession"

  constructor(
    private client: SqlClient,
    dialect: SQLiteAsyncDialect,
    protected relations: TRelations,
    private options: EffectSQLiteSessionOptions,
  ) {
    super(dialect)
  }

  override prepareQuery<T extends PreparedQueryConfig = PreparedQueryConfig>(
    query: Query,
    fields: SelectedFieldsOrdered | undefined,
    executeMethod: SQLiteExecuteMethod,
    customResultMapper?: (rows: unknown[][], mapColumnValue?: (value: unknown) => unknown) => unknown,
    queryMetadata?: {
      type: "select" | "update" | "delete" | "insert"
      tables: string[]
    },
    cacheConfig?: WithCacheConfig,
  ): SQLiteEffectPreparedQuery<T, EffectSQLiteQueryEffectHKT> {
    return new SQLiteEffectPreparedQuery<T, EffectSQLiteQueryEffectHKT>(
      (params, method) => this.execute(query, params, method),
      query,
      this.options.logger,
      this.options.cache,
      queryMetadata,
      cacheConfig,
      fields,
      executeMethod,
      this.options.useJitMappers,
      customResultMapper,
      undefined,
      undefined,
      this.isInTransaction(),
    )
  }

  override prepareRelationalQuery<T extends PreparedQueryConfig = PreparedQueryConfig>(
    query: Query,
    fields: SelectedFieldsOrdered | undefined,
    executeMethod: SQLiteExecuteMethod,
    customResultMapper: (rows: Record<string, unknown>[], mapColumnValue?: (value: unknown) => unknown) => unknown,
    config: RelationalQueryMapperConfig,
  ): SQLiteEffectPreparedQuery<T, EffectSQLiteQueryEffectHKT, true> {
    return new SQLiteEffectPreparedQuery<T, EffectSQLiteQueryEffectHKT, true>(
      (params, method) => this.execute(query, params, method),
      query,
      this.options.logger,
      this.options.cache,
      undefined,
      undefined,
      fields,
      executeMethod,
      this.options.useJitMappers,
      customResultMapper,
      true,
      config,
      this.isInTransaction(),
    )
  }

  private execute(query: Query, params: unknown[], method: SQLiteExecuteMethod | "values") {
    const statement = this.client.unsafe(query.sql, params)
    if (method === "values") return statement.values
    if (method === "get") return statement.withoutTransform.pipe(Effect.map((rows) => rows[0]))
    return statement.withoutTransform
  }

  private isInTransaction() {
    return Effect.serviceOption(this.client.transactionService).pipe(Effect.map((option) => option._tag === "Some"))
  }

  private executeTransactionStatement(connection: Effect.Success<SqlClient["reserve"]>, query: string) {
    return connection.executeUnprepared(query, [], undefined).pipe(Effect.asVoid)
  }

  private withTransaction<A, E, R>(effect: Effect.Effect<A, E, R>, config: SQLiteEffectTransactionConfig | undefined) {
    return Effect.uninterruptibleMask((restore) =>
      Effect.withFiber<A, E | SqlError, R>((fiber) => {
        const services = fiber.context
        const connectionOption = Context.getOption(services, this.client.transactionService)
        const connection: Effect.Effect<
          readonly [Scope.Closeable | undefined, Effect.Success<SqlClient["reserve"]>],
          SqlError
        > =
          connectionOption._tag === "Some"
            ? Effect.succeed([undefined, connectionOption.value[0]] as const)
            : Scope.make().pipe(
                Effect.flatMap((scope) =>
                  Scope.provide(this.client.reserve, scope).pipe(
                    Effect.map((connection) => [scope, connection] as const),
                    Effect.catch((error) =>
                      Scope.close(scope, Exit.fail(error)).pipe(Effect.andThen(Effect.fail(error))),
                    ),
                  ),
                ),
              )
        const id = connectionOption._tag === "Some" ? connectionOption.value[1] + 1 : 0
        const behavior = config?.behavior ?? this.options.transaction?.behavior ?? "deferred"

        const once = connection.pipe(
          Effect.flatMap(([scope, connection]) => {
            // The outermost transaction owns the after-commit hooks; a savepoint adds to the ones
            // around it, since only the outer commit makes anything durable.
            const hooks = id === 0 ? { afterCommit: new Array<Effect.Effect<void>>() } : undefined
            const inTransaction = Context.add(services, this.client.transactionService, [connection, id] as const)
            const transaction = this.executeTransactionStatement(
              connection,
              id === 0 ? `begin ${behavior}` : `savepoint effect_sql_${id}`,
            ).pipe(
              Effect.flatMap(() =>
                Effect.provideContext(
                  restore(effect),
                  hooks ? Context.add(inTransaction, TransactionHooks, hooks) : inTransaction,
                ).pipe(
                  Effect.exit,
                  Effect.flatMap((exit) => {
                    const finalize = Exit.isSuccess(exit)
                      ? id === 0
                        ? this.executeTransactionStatement(connection, "commit").pipe(
                            // SQLite keeps the transaction open after deferred constraint commit failures.
                            Effect.catch((error) =>
                              this.executeTransactionStatement(connection, "rollback").pipe(
                                Effect.catch(() => Effect.void),
                                Effect.andThen(Effect.fail(error)),
                              ),
                            ),
                          )
                        : this.executeTransactionStatement(connection, `release savepoint effect_sql_${id}`)
                      : id === 0
                        ? this.executeTransactionStatement(connection, "rollback")
                        : this.executeTransactionStatement(connection, `rollback to savepoint effect_sql_${id}`).pipe(
                            Effect.andThen(
                              this.executeTransactionStatement(connection, `release savepoint effect_sql_${id}`),
                            ),
                          )

                    return finalize.pipe(Effect.flatMap(() => exit))
                  }),
                ),
              ),
            )

            const released =
              scope === undefined ? transaction : transaction.pipe(Effect.onExit((exit) => Scope.close(scope, exit)))
            // Hooks run once the commit is through and the connection is back in the pool, so a
            // listener never sees state that may still roll back and never holds up other writers.
            return hooks
              ? released.pipe(
                  Effect.flatMap((value) =>
                    restore(Effect.forEach(hooks.afterCommit, (hook) => hook, { discard: true })).pipe(
                      Effect.as(value),
                    ),
                  ),
                )
              : released
          }),
        )

        // Only the outermost transaction is begun again: a savepoint's lock failure belongs to the
        // transaction around it. The connection is released before the wait, so other fibers of
        // this process get their turn while another process finishes its write.
        const retry = config?.retry ?? this.options.transaction?.retry
        if (id !== 0 || !retry || retry.attempts <= 0) return once
        const attempt = (n: number): Effect.Effect<A, E | SqlError, R> =>
          once.pipe(
            Effect.catchIf(
              (error) => n < retry.attempts && isLockError(error),
              () => {
                const delay = retryDelay(retry, n)
                return restore(
                  (retry.onRetry?.(n + 1, delay) ?? Effect.void).pipe(Effect.andThen(Effect.sleep(delay))),
                ).pipe(Effect.flatMap(() => attempt(n + 1)))
              },
            ),
          )
        return attempt(0)
      }),
    )
  }

  override transaction<A, E, R>(
    transaction: (tx: EffectSQLiteTransaction<TRelations>) => Effect.Effect<A, E, R>,
    config?: SQLiteEffectTransactionConfig,
  ): Effect.Effect<A, E | SqlError, R> {
    const { dialect, relations } = this

    return this.withTransaction(
      Effect.gen({ self: this }, function* () {
        const tx = new EffectSQLiteTransaction<TRelations>(dialect, this, relations)

        return yield* transaction(tx)
      }),
      config,
    )
  }
}

export class EffectSQLiteTransaction<TRelations extends AnyRelations> extends SQLiteEffectTransaction<
  EffectSQLiteQueryEffectHKT,
  EffectSQLiteRunResult,
  TRelations
> {
  static override readonly [entityKind]: string = "EffectSQLiteTransaction"

  override transaction: <A, E, R>(
    transaction: (
      tx: SQLiteEffectTransaction<EffectSQLiteQueryEffectHKT, EffectSQLiteRunResult, TRelations>,
    ) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, SqlError | E, R> = (tx) => this.session.transaction(tx)
}
