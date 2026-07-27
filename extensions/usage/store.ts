import { createHash } from "node:crypto";
import { chmodSync, closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { UsageEvent, UsageTotals } from "./types.ts";

const SCHEMA_VERSION = 1;

export type SourceCursor = { offset: number; headerHash: string };

export class UsageStore {
  readonly db: DatabaseSync;
  readonly path: string;

  constructor(stateDir: string) {
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    chmodSync(stateDir, 0o700);
    this.path = join(stateDir, "usage.sqlite3");
    const existed = existsSync(this.path);
    if (!existed) closeSync(openSync(this.path, "wx", 0o600));
    this.db = new DatabaseSync(this.path);
    try {
      const version = this.db.prepare("PRAGMA user_version").get() as { user_version: number };
      if (version.user_version !== 0 && version.user_version !== SCHEMA_VERSION) {
        throw new Error(`Unsupported usage ledger schema version ${version.user_version}`);
      }
      if (version.user_version === 0) {
        const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
        if (tables.length > 0) throw new Error("Unversioned usage ledger is not supported");
        this.initialize();
      }
      chmodSync(this.path, 0o600);
    } catch (error) {
      this.db.close();
      if (!existed && existsSync(this.path)) chmodSync(this.path, 0o600);
      throw error;
    }
  }

  private initialize(): void {
    this.db.exec(`
      BEGIN;
      CREATE TABLE events (
        identity TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        operation TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        project_path TEXT NOT NULL,
        input INTEGER NOT NULL,
        output INTEGER NOT NULL,
        cache_read INTEGER NOT NULL,
        cache_write INTEGER NOT NULL,
        cost REAL NOT NULL,
        responses INTEGER NOT NULL
      );
      CREATE INDEX events_timestamp_idx ON events(timestamp);
      CREATE TABLE sources (
        source_identity TEXT PRIMARY KEY,
        offset INTEGER NOT NULL,
        header_hash TEXT NOT NULL
      );
      PRAGMA user_version = ${SCHEMA_VERSION};
      COMMIT;
    `);
  }

  addEvent(event: UsageEvent): boolean {
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO events
      (identity, timestamp, operation, provider, model, project_path, input, output, cache_read, cache_write, cost, responses)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(event.identity, event.timestamp, event.operation, event.provider, event.model, event.projectPath,
      event.input, event.output, event.cacheRead, event.cacheWrite, event.cost, event.responses);
    return result.changes === 1;
  }

  private sourceIdentity(path: string): string {
    return createHash("sha256").update(`oh-my-pi-usage-source-v1\0${path}`).digest("hex");
  }

  source(path: string): SourceCursor | undefined {
    const row = this.db.prepare("SELECT offset, header_hash AS headerHash FROM sources WHERE source_identity = ?")
      .get(this.sourceIdentity(path));
    return row as SourceCursor | undefined;
  }

  saveSource(path: string, cursor: SourceCursor): void {
    this.db.prepare(`
      INSERT INTO sources(source_identity, offset, header_hash) VALUES (?, ?, ?)
      ON CONFLICT(source_identity) DO UPDATE SET offset = excluded.offset, header_hash = excluded.header_hash
    `).run(this.sourceIdentity(path), cursor.offset, cursor.headerHash);
  }

  totals(from: Date, to: Date): UsageTotals {
    return this.db.prepare(`
      SELECT COALESCE(SUM(input), 0) AS input, COALESCE(SUM(output), 0) AS output,
        COALESCE(SUM(cache_read), 0) AS cacheRead, COALESCE(SUM(cache_write), 0) AS cacheWrite,
        COALESCE(SUM(cost), 0) AS cost, COALESCE(SUM(responses), 0) AS responses
      FROM events WHERE timestamp >= ? AND timestamp < ?
    `).get(from.toISOString(), to.toISOString()) as UsageTotals;
  }

  eventCount(): number {
    return (this.db.prepare("SELECT COUNT(*) AS count FROM events").get() as { count: number }).count;
  }

  close(): void {
    this.db.close();
  }
}
