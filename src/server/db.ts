import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

// /data is the one thing that survives a restart or redeploy (fly.toml mounts
// the volume there). Locally, DB_PATH can point anywhere.
const DB_PATH = process.env.DB_PATH ?? "/data/app.db";

export function openDb(path: string = DB_PATH): Database.Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  // WAL + a busy timeout: single-writer SQLite on one machine is fine for
  // this project's scale, but without busy_timeout any write contention
  // surfaces as an immediate SQLITE_BUSY instead of a short wait.
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  return db;
}

export const db: Database.Database = openDb();
