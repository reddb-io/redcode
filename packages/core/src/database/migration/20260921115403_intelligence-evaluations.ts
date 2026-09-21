import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260921115403_intelligence-evaluations",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`intelligence_answer\` (
          \`evaluation_id\` text NOT NULL,
          \`question_id\` text NOT NULL,
          \`type\` text NOT NULL,
          \`noul\` real,
          \`choice\` text,
          \`score\` real,
          \`confidence\` real,
          \`probabilities\` text,
          \`legend\` text,
          CONSTRAINT \`intelligence_answer_pk\` PRIMARY KEY(\`evaluation_id\`, \`question_id\`),
          CONSTRAINT \`fk_intelligence_answer_evaluation_id_intelligence_evaluation_id_fk\` FOREIGN KEY (\`evaluation_id\`) REFERENCES \`intelligence_evaluation\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`intelligence_evaluation\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text,
          \`operation\` text NOT NULL,
          \`evaluation_kind\` text NOT NULL,
          \`subject_id\` text,
          \`candidate_id\` text,
          \`attempt\` integer DEFAULT 0 NOT NULL,
          \`fingerprint\` text NOT NULL,
          \`policy\` text NOT NULL,
          \`decision\` text NOT NULL,
          \`model\` text NOT NULL,
          \`evaluator\` text,
          \`issues\` text NOT NULL,
          \`input_tokens\` integer NOT NULL,
          \`output_tokens\` integer NOT NULL,
          \`duration\` integer NOT NULL,
          \`artifact\` text,
          \`source_hash\` text NOT NULL,
          \`candidate_hash\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`fk_intelligence_evaluation_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE SET NULL
        );
      `)
      yield* tx.run(
        `CREATE UNIQUE INDEX \`intelligence_evaluation_fingerprint_idx\` ON \`intelligence_evaluation\` (\`fingerprint\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`intelligence_evaluation_session_created_idx\` ON \`intelligence_evaluation\` (\`session_id\`,\`time_created\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`intelligence_evaluation_operation_created_idx\` ON \`intelligence_evaluation\` (\`operation\`,\`time_created\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`intelligence_evaluation_decision_created_idx\` ON \`intelligence_evaluation\` (\`decision\`,\`time_created\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`intelligence_evaluation_subject_idx\` ON \`intelligence_evaluation\` (\`subject_id\`);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
