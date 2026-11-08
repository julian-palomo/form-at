import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

// A real SQLite database behind the handful of `D1Database` methods the shared
// queries use: `prepare().bind().run()/first()/all()` and `batch()`. The
// queries run unchanged, so a test exercises their actual SQL (the conditional
// WHERE clauses that stop overselling) instead of a hand-written mock that
// returns whatever the test expects.
//
// It loads the whole of `apps/web/schema.sql`, the same file a fresh D1
// database is built from, so a test also fails when the schema stops parsing.
//
// Limit: Node runs one statement at a time, so two "concurrent" calls here run
// one after the other. That proves the WHERE clauses let only one write
// through; it doesn't reproduce D1's own concurrency, which relies on SQLite
// executing each statement atomically.

const SCHEMA_PATH = resolve(__dirname, "../../../../apps/web/schema.sql");

type Params = SQLInputValue[];

function normalise(values: unknown[]): Params {
  return values.map((v) => (v === undefined ? null : (v as SQLInputValue)));
}

class Statement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    private readonly params: Params = [],
  ) {}

  bind(...values: unknown[]): Statement {
    return new Statement(this.db, this.sql, normalise(values));
  }

  async first<T>(): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.params);
    return (row as T | undefined) ?? null;
  }

  async all<T>(): Promise<{ results: T[]; success: true; meta: Record<string, never> }> {
    const rows = this.db.prepare(this.sql).all(...this.params);
    return { results: rows as T[], success: true, meta: {} };
  }

  async run(): Promise<{ success: true; meta: { changes: number; last_row_id: number } }> {
    return this.runSync();
  }

  runSync(): { success: true; meta: { changes: number; last_row_id: number } } {
    const result = this.db.prepare(this.sql).run(...this.params);
    return {
      success: true,
      meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) },
    };
  }
}

export type TestD1 = D1Database & { raw: DatabaseSync };

/** A fresh in-memory database built from `apps/web/schema.sql`. */
export function createTestD1(): TestD1 {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(SCHEMA_PATH, "utf8"));

  const d1 = {
    raw: db,
    prepare: (sql: string) => new Statement(db, sql),
    // D1 runs a batch as one transaction: every statement applies, or none do.
    batch: async (statements: Statement[]) => {
      db.exec("BEGIN");
      try {
        const results = statements.map((s) => s.runSync());
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return d1 as unknown as TestD1;
}
