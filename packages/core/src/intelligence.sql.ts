import { index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { SessionTable } from "./session/sql"

export const IntelligenceEvaluationTable = sqliteTable(
  "intelligence_evaluation",
  {
    id: text().primaryKey(),
    session_id: text().references(() => SessionTable.id, { onDelete: "set null" }),
    operation: text().notNull(),
    evaluation_kind: text().notNull(),
    subject_id: text(),
    candidate_id: text(),
    attempt: integer().notNull().default(0),
    fingerprint: text().notNull(),
    policy: text().notNull(),
    decision: text().notNull(),
    model: text().notNull(),
    evaluator: text({ mode: "json" }).$type<{ transport: string; baseURL: string; model: string }>(),
    issues: text({ mode: "json" }).$type<string[]>().notNull(),
    input_tokens: integer().notNull(),
    output_tokens: integer().notNull(),
    duration: integer().notNull(),
    artifact: text(),
    source_hash: text().notNull(),
    candidate_hash: text().notNull(),
    time_created: integer().notNull(),
  },
  (table) => [
    index("intelligence_evaluation_fingerprint_lookup_idx").on(table.fingerprint),
    index("intelligence_evaluation_session_created_idx").on(table.session_id, table.time_created),
    index("intelligence_evaluation_operation_created_idx").on(table.operation, table.time_created),
    index("intelligence_evaluation_decision_created_idx").on(table.decision, table.time_created),
    index("intelligence_evaluation_subject_idx").on(table.subject_id),
  ],
)

export const IntelligenceAnswerTable = sqliteTable(
  "intelligence_answer",
  {
    evaluation_id: text()
      .notNull()
      .references(() => IntelligenceEvaluationTable.id, { onDelete: "cascade" }),
    question_id: text().notNull(),
    type: text().notNull(),
    noul: real(),
    choice: text(),
    score: real(),
    confidence: real(),
    probabilities: text({ mode: "json" }).$type<Record<string, number>>(),
    legend: text({ mode: "json" }).$type<Record<string, unknown>>(),
  },
  (table) => [primaryKey({ columns: [table.evaluation_id, table.question_id] })],
)
